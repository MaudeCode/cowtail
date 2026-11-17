#!/usr/bin/env node
// Decides whether a release artifact still needs publishing, so a release can run again for the same version.
// Absent: publish. Published from this commit: skip. Published from anything else: refuse.
// Writes publish=true|false to $GITHUB_OUTPUT.
//
//   published.mjs npm <package> <version> <sha>
//   published.mjs image <ref> <sha>
//   published.mjs testflight <bundle id> <version> <build number>   (build numbers come from the commit)
import { spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Commits recorded by an npm version's SLSA provenance attestations. */
export function provenanceCommits(attestations) {
  return attestations
    .filter((attestation) => attestation.predicateType === "https://slsa.dev/provenance/v1")
    .flatMap(
      (attestation) =>
        JSON.parse(Buffer.from(attestation.bundle.dsseEnvelope.payload, "base64").toString("utf8"))
          .predicate.buildDefinition.resolvedDependencies,
    )
    .map((dependency) => dependency.digest.gitCommit)
    .filter(Boolean);
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GET ${url} failed: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function npmPublishedFrom(name, version) {
  const manifest = await getJson(
    `https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`,
  );
  if (!manifest) return [];
  const url = manifest.dist?.attestations?.url;
  const commits = url ? provenanceCommits((await getJson(url))?.attestations ?? []) : [];
  return commits.length > 0 ? commits : ["a publish without provenance"];
}

function imagePublishedFrom(ref) {
  const inspect = spawnSync(
    "docker",
    ["buildx", "imagetools", "inspect", ref, "--format", "{{json .Image}}"],
    {
      encoding: "utf8",
    },
  );
  if (inspect.status !== 0) {
    if (/not found/i.test(inspect.stderr)) return [];
    throw new Error(`Inspecting ${ref} failed: ${inspect.stderr || inspect.error}`);
  }
  const image = JSON.parse(inspect.stdout);
  // A single image has a config; a multi-platform index maps each platform to its image.
  return (image.config ? [image] : Object.values(image)).map(
    (platformImage) =>
      platformImage.config?.Labels?.["org.opencontainers.image.revision"] ??
      "an image without a revision label",
  );
}

function appStoreConnectToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "ES256", kid: process.env.APP_STORE_CONNECT_KEY_ID, typ: "JWT" })}.${encode(
    {
      iss: process.env.APP_STORE_CONNECT_ISSUER_ID,
      aud: "appstoreconnect-v1",
      iat: now - 60,
      exp: now + 600,
    },
  )}`;
  const signature = createSign("SHA256")
    .update(input)
    .sign({ key: process.env.APP_STORE_CONNECT_PRIVATE_KEY, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

async function testflightBuilds(bundleId, version, build) {
  const headers = { authorization: `Bearer ${appStoreConnectToken()}` };
  const api = (path, query) =>
    getJson(
      `https://api.appstoreconnect.apple.com/v1/${path}?${new URLSearchParams(query)}`,
      headers,
    );
  const apps = ((await api("apps", { "filter[bundleId]": bundleId }))?.data ?? []).filter(
    (app) => app.attributes.bundleId === bundleId,
  );
  if (apps.length !== 1)
    throw new Error(`Expected one App Store Connect app for ${bundleId}, found ${apps.length}.`);
  const builds = await api("builds", {
    "filter[app]": apps[0].id,
    "filter[preReleaseVersion.version]": version,
    "filter[preReleaseVersion.platform]": "IOS",
    "fields[builds]": "version,processingState",
    limit: "200",
  });
  const found = (builds?.data ?? []).map(({ attributes }) => attributes);
  // Uploading again cannot help a build Apple is still processing; it counts once processing has succeeded.
  if (
    found.some(
      (existing) => existing.version === build && existing.processingState === "PROCESSING",
    )
  ) {
    throw new Error(
      `TestFlight build ${version} (${build}) is still processing. Re-run this job once it has finished.`,
    );
  }
  // Only a successfully processed build counts as published, so a release cannot pass on a failed one.
  return found.map(({ version: number, processingState }) =>
    processingState === "VALID" ? number : `${processingState.toLowerCase()} build ${number}`,
  );
}

const sources = {
  npm: async (name, version, sha) => [
    `npm ${name}@${version}`,
    await npmPublishedFrom(name, version),
    sha,
  ],
  image: async (ref, sha) => [ref, imagePublishedFrom(ref), sha],
  testflight: async (bundleId, version, build) => [
    `TestFlight ${version} (${build})`,
    await testflightBuilds(bundleId, version, build),
    build,
  ],
};

async function main([kind, ...args]) {
  const source = sources[kind];
  if (!source || args.some((arg) => !arg))
    throw new Error(`Usage: published.mjs npm|image|testflight <arguments>`);
  const [name, publishedFrom, mine] = await source(...args);
  const publish = publishedFrom.length === 0;
  if (!publish && publishedFrom.some((from) => from !== mine)) {
    throw new Error(
      `${name} is already published from ${[...new Set(publishedFrom)].join(", ")}, not ${mine}. Release the next version.`,
    );
  }
  console.log(
    publish ? `${name} is not published yet.` : `${name} is already published from ${mine}.`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
