const GENERAL_HELP_TEXT = `cowtail

Usage:
  cowtail help [command]
  cowtail version
  cowtail alert create [options]
  cowtail fix create [options]
  cowtail subs list [--json]
  cowtail push send [options]
  cowtail push test [options]
  cowtail auth whoami [--json]

Commands:
  version         Print the build version
  alert create    Create an alert record in Cowtail
  fix create      Create a fix linked to one or more alerts
  subs list       List current Apple subs with enabled device counts
  push send       Send a push notification to a Cowtail user
  push test       Send a test push notification
  auth whoami     Print resolved config and auth status

Config:
  Default file: ~/.config/cowtail/config.json
  Override path with: COWTAIL_CONFIG_PATH
  Required field: baseUrl

Use "cowtail help <command>" for command-specific flags.`;

const ALERT_CREATE_HELP_TEXT = `cowtail alert create

Usage:
  cowtail alert create --alertname <name> --severity <severity> --namespace <namespace> --status <firing|resolved> --outcome <fixed|self-resolved|noise|escalated> --summary <text> --action <text> [options]

Options:
  --alertname <name>
  --severity <severity>
  --namespace <namespace>
  --status <firing|resolved>
  --outcome <fixed|self-resolved|noise|escalated>
  --summary <text>
  --action <text>
  --root-cause <text>
  --node <node>
  --messaged
  --timestamp <ms-or-iso>
  --resolved-at <ms-or-iso>
  --json`;

const FIX_CREATE_HELP_TEXT = `cowtail fix create

Usage:
  cowtail fix create --alert-id <id> [--alert-id <id> ...] --description <text> --root-cause <text> --scope <reactive|weekly|monthly> [options]

Options:
  --alert-id <id>         Repeatable
  --alert-ids <id,id,...>
  --description <text>
  --root-cause <text>
  --scope <reactive|weekly|monthly>
  --commit <sha>
  --timestamp <ms-or-iso>
  --json`;

const PUSH_SEND_HELP_TEXT = `cowtail push send

Usage:
  cowtail push send --user-id <apple-sub> --title <text> --body <text> [options]

Options:
  --user-id <apple-sub>
  --title <text>
  --body <text>
  --data <json-object>
  --json`;

const PUSH_TEST_HELP_TEXT = `cowtail push test

Usage:
  cowtail push test --user-id <apple-sub> [options]

Options:
  --user-id <apple-sub>
  --title <text>
  --body <text>
  --data <json-object>
  --json`;

const SUBS_LIST_HELP_TEXT = `cowtail subs list

Usage:
  cowtail subs list [--json]

Lists:
  - current Apple subs with at least one enabled device registration
  - enabled device count per sub

Auth:
  Requires pushBearerToken in ~/.config/cowtail/config.json
  Requires baseUrl in the config file`;

const AUTH_HELP_TEXT = `cowtail auth whoami

Usage:
  cowtail auth whoami [--json]

Prints:
  - resolved config path
  - whether the config file exists
  - resolved base URL, if configured
  - whether a push token is configured
  - timeout in milliseconds`;

const VERSION_HELP_TEXT = `cowtail version

Usage:
  cowtail version
  cowtail --version

Prints:
  - the build version embedded in the current CLI binary`;

export function getAlertCreateHelpText(): string {
  return ALERT_CREATE_HELP_TEXT;
}

export function getFixCreateHelpText(): string {
  return FIX_CREATE_HELP_TEXT;
}

export function getPushSendHelpText(): string {
  return PUSH_SEND_HELP_TEXT;
}

export function getPushTestHelpText(): string {
  return PUSH_TEST_HELP_TEXT;
}

export function getSubsListHelpText(): string {
  return SUBS_LIST_HELP_TEXT;
}

export function getAuthHelpText(): string {
  return AUTH_HELP_TEXT;
}

export function getVersionHelpText(): string {
  return VERSION_HELP_TEXT;
}

export function printHelp(topic: string[] = []): void {
  const [command, subcommand] = topic;

  if (!command) {
    console.log(GENERAL_HELP_TEXT);
    return;
  }

  switch (command) {
    case "alert":
      console.log(ALERT_CREATE_HELP_TEXT);
      return;
    case "fix":
      console.log(FIX_CREATE_HELP_TEXT);
      return;
    case "push":
      console.log(subcommand === "test" ? PUSH_TEST_HELP_TEXT : PUSH_SEND_HELP_TEXT);
      return;
    case "subs":
      console.log(SUBS_LIST_HELP_TEXT);
      return;
    case "auth":
      console.log(AUTH_HELP_TEXT);
      return;
    case "version":
      console.log(VERSION_HELP_TEXT);
      return;
    default:
      console.log(GENERAL_HELP_TEXT);
  }
}
