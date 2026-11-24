import { defineCommandEntry, defineCommandGroup } from "../types.ts";

import { SourcesAddCommand, SOURCES_ADD_DESCRIPTION } from "./add.ts";
import { SourcesDisableCommand, SOURCES_DISABLE_DESCRIPTION } from "./disable.ts";
import { SourcesIconCommand, SOURCES_ICON_DESCRIPTION } from "./icon.ts";
import { SourcesListCommand, SOURCES_LIST_DESCRIPTION } from "./list.ts";
import { SourcesRotateCommand, SOURCES_ROTATE_DESCRIPTION } from "./rotate.ts";

export const SOURCES_GROUP_DESCRIPTION = `Notification source commands.`;

export const sourcesCommandGroup = defineCommandGroup(`sources`, SOURCES_GROUP_DESCRIPTION, [
  defineCommandEntry(`add`, SOURCES_ADD_DESCRIPTION, SourcesAddCommand),
  defineCommandEntry(`list`, SOURCES_LIST_DESCRIPTION, SourcesListCommand),
  defineCommandEntry(`rotate`, SOURCES_ROTATE_DESCRIPTION, SourcesRotateCommand),
  defineCommandEntry(`icon`, SOURCES_ICON_DESCRIPTION, SourcesIconCommand),
  defineCommandEntry(`disable`, SOURCES_DISABLE_DESCRIPTION, SourcesDisableCommand),
]);
