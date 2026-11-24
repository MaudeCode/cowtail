import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "../lib/api";
import { providersQuery } from "../lib/queries";

// The four Convex variables that turn on web sign-in (COW-33).
const OIDC_VARIABLES = [
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "COWTAIL_OWNER_OIDC_SUBJECT",
];

export default function Login() {
  const { data, error, isPending } = useQuery(providersQuery);

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 text-[0.8125rem] text-txt">
      <div className="grid max-w-[300px] justify-items-center gap-3.5 text-center">
        <h1 className="text-xl font-bold tracking-[0.22em] text-accent-text">COWTAIL</h1>
        {isPending ? null : data?.oidc ? (
          <a
            href="/actions/api/auth/oidc/start?client=web"
            className="inline-flex h-9 items-center rounded-[7px] border border-gray-200 bg-surface-2 px-[18px] font-semibold"
          >
            Sign in with {data.oidc.name}
          </a>
        ) : data ? (
          <div>
            Web sign-in is not configured. Set these Convex variables:
            <pre className="mt-2.5 border-l-2 border-gray-200 bg-surface px-2.5 py-2 text-left font-mono text-[0.7rem] text-gray-600">
              {OIDC_VARIABLES.join("\n")}
            </pre>
          </div>
        ) : (
          <p role="alert" className="text-accent-text">
            {errorMessage(error)}
          </p>
        )}
      </div>
    </main>
  );
}
