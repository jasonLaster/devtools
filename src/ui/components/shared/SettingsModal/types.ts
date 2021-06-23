import { UserInfo } from "ui/hooks/users";
import { SettingsTabTitle } from "ui/state/app";
import { UserSettings } from "ui/types";

export type Settings = Setting[];

export type SettingType = "checkbox" | "dropdown";

export interface Setting {
  title: SettingsTabTitle;
  items: SettingItem[];
  enabled: (userInfo: UserInfo) => boolean;
  icon?: string;
}

export interface SettingItem {
  label: string;
  type: SettingType;
  key: SettingItemKey;
  description: string | null;
  disabled: boolean;
  needsRefresh: boolean;
}

export type SettingItemKey = keyof UserSettings;
