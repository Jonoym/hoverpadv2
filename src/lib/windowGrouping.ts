import { invoke } from "@tauri-apps/api/core";

export interface GroupInfo {
  groupId: number;
  labels: string[];
}

/**
 * Group multiple windows together so dragging one moves them all.
 * Returns the group ID.
 */
export async function groupWindows(labels: string[]): Promise<number> {
  return invoke<number>("group_windows", { labels });
}

/**
 * Remove a single window from its group.
 * If only one window remains, the group is dissolved.
 */
export async function ungroupWindow(label: string): Promise<void> {
  return invoke("ungroup_window", { label });
}

/**
 * Dissolve all window groups and remove all subclasses.
 */
export async function ungroupAll(): Promise<void> {
  return invoke("ungroup_all");
}

/**
 * Dissolve a specific group by ID, ungrouping all its members.
 */
export async function ungroupGroup(groupId: number): Promise<void> {
  return invoke("ungroup_group", { groupId });
}

/**
 * List all active window groups and their member labels.
 */
export async function listGroups(): Promise<GroupInfo[]> {
  return invoke<GroupInfo[]>("list_groups");
}
