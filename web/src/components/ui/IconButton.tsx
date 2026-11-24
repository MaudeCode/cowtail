import type { ButtonHTMLAttributes } from "react";

import Icon, { type IconName } from "./Icon";

const tones = {
  plain: "border-gray-200 bg-surface-2 text-txt",
  yes: "border-[#2d9b5280] bg-[#2d9b521f] text-ok",
  no: "border-[#b8242c99] bg-[#b8242c1f] text-accent-text",
} as const;

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  // The accessible name and the tooltip.
  label: string;
  tone?: keyof typeof tones;
  small?: boolean;
}

// Every action is an icon with a tooltip and an accessible name.
export default function IconButton({
  icon,
  label,
  tone = "plain",
  small = false,
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      className={`grid shrink-0 cursor-pointer place-items-center rounded-[7px] border disabled:cursor-default disabled:opacity-50 ${small ? "size-5" : "size-[26px]"} ${tones[tone]} ${className}`}
      {...props}
    >
      <Icon name={icon} className={small ? "size-3" : "size-3.5"} />
    </button>
  );
}
