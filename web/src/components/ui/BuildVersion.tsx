import { appVersionLabel } from "../../lib/version";

export default function BuildVersion() {
  return <span className="text-gray-500"> · {appVersionLabel}</span>;
}
