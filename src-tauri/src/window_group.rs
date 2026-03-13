use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BeginDeferWindowPos, DeferWindowPos, EndDeferWindowPos, GetWindowRect,
    SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, WM_DESTROY,
    WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_MOVING, WM_NCLBUTTONDBLCLK,
    WM_SYSCOMMAND, SC_MAXIMIZE,
    GWL_STYLE, GetWindowLongW, SetWindowLongW, WS_MAXIMIZEBOX,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::POINT;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct WindowGroupState {
    inner: Mutex<GroupInner>,
}

#[derive(Default)]
struct GroupInner {
    next_group_id: u32,
    /// group_id → list of (hwnd, label)
    groups: HashMap<u32, Vec<GroupMember>>,
    /// hwnd → group_id (reverse lookup)
    hwnd_to_group: HashMap<isize, u32>,
    /// hwnd → last known position (left, top, right, bottom) in physical pixels
    last_positions: HashMap<isize, (i32, i32, i32, i32)>,
    /// Set of HWNDs that have been subclassed
    subclassed: std::collections::HashSet<isize>,
    /// Re-entrancy guard: true while we are programmatically moving grouped windows
    moving: bool,
}

#[derive(Clone)]
struct GroupMember {
    hwnd: isize,
    label: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    group_id: u32,
    labels: Vec<String>,
}

// ---------------------------------------------------------------------------
// Subclass procedure (Windows-only)
// ---------------------------------------------------------------------------

/// Subclass ID — arbitrary unique constant for our subclass.
#[cfg(target_os = "windows")]
const SUBCLASS_ID: usize = 0x4F56_0001;

/// The subclass callback. `ref_data` is a raw pointer to `*const WindowGroupState`.
#[cfg(target_os = "windows")]
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    let state = &*(ref_data as *const WindowGroupState);

    match msg {
        WM_ENTERSIZEMOVE => {
            // Snapshot positions of all windows in this HWND's group
            if let Ok(mut inner) = state.inner.try_lock() {
                if let Some(&group_id) = inner.hwnd_to_group.get(&(hwnd as isize)) {
                    let hwnds: Vec<isize> = inner
                        .groups
                        .get(&group_id)
                        .map(|m| m.iter().map(|gm| gm.hwnd).collect())
                        .unwrap_or_default();
                    for h in hwnds {
                        let mut rect: RECT = std::mem::zeroed();
                        if GetWindowRect(h as HWND, &mut rect) != 0 {
                            inner
                                .last_positions
                                .insert(h, (rect.left, rect.top, rect.right, rect.bottom));
                        }
                    }
                }
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }

        WM_MOVING => {
            // The lparam is a mutable pointer to the proposed RECT for the dragged window.
            let proposed_rect = &mut *(lparam as *mut RECT);

            // Clamp the dragged window itself so it can't go off-screen
            {
                let (cl, ct) = clamp_top_to_screen(
                    proposed_rect.left, proposed_rect.top,
                    proposed_rect.right, proposed_rect.bottom,
                );
                let w = proposed_rect.right - proposed_rect.left;
                let h = proposed_rect.bottom - proposed_rect.top;
                proposed_rect.left = cl;
                proposed_rect.top = ct;
                proposed_rect.right = cl + w;
                proposed_rect.bottom = ct + h;
            }

            let should_move = if let Ok(mut inner) = state.inner.try_lock() {
                if inner.moving {
                    // Re-entrant call from our own DeferWindowPos — skip
                    None
                } else if let Some(&group_id) = inner.hwnd_to_group.get(&(hwnd as isize)) {
                    // Compute delta from last known position
                    if let Some(&(last_left, last_top, _, _)) =
                        inner.last_positions.get(&(hwnd as isize))
                    {
                        let dx = proposed_rect.left - last_left;
                        let dy = proposed_rect.top - last_top;

                        if dx != 0 || dy != 0 {
                            // Update the dragged window's position
                            inner.last_positions.insert(
                                hwnd as isize,
                                (
                                    proposed_rect.left,
                                    proposed_rect.top,
                                    proposed_rect.right,
                                    proposed_rect.bottom,
                                ),
                            );

                            // Collect other windows to move, clamped to screen
                            let others: Vec<(isize, i32, i32, i32, i32)> = inner
                                .groups
                                .get(&group_id)
                                .map(|members| {
                                    members
                                        .iter()
                                        .filter(|m| m.hwnd != hwnd as isize)
                                        .filter_map(|m| {
                                            inner.last_positions.get(&m.hwnd).map(|&(l, t, r, b)| {
                                                let new_l = l + dx;
                                                let new_t = t + dy;
                                                let new_r = r + dx;
                                                let new_b = b + dy;
                                                let (clamped_l, clamped_t) =
                                                    clamp_top_to_screen(new_l, new_t, new_r, new_b);
                                                let w = new_r - new_l;
                                                let h = new_b - new_t;
                                                (m.hwnd, clamped_l, clamped_t, clamped_l + w, clamped_t + h)
                                            })
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();

                            inner.moving = true;
                            Some((others, dx, dy))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            if let Some((others, _dx, _dy)) = should_move {
                if !others.is_empty() {
                    let hdwp = BeginDeferWindowPos(others.len() as i32);
                    if !hdwp.is_null() {
                        let mut current_hdwp = hdwp;
                        for (other_hwnd, new_left, new_top, new_right, new_bottom) in &others {
                            let w = new_right - new_left;
                            let h = new_bottom - new_top;
                            let result = DeferWindowPos(
                                current_hdwp,
                                *other_hwnd as HWND,
                                std::ptr::null_mut(),
                                *new_left,
                                *new_top,
                                w,
                                h,
                                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOSIZE,
                            );
                            if !result.is_null() {
                                current_hdwp = result;
                            }
                        }
                        EndDeferWindowPos(current_hdwp);
                    }

                    // Update last_positions for moved windows
                    if let Ok(mut inner) = state.inner.try_lock() {
                        for (other_hwnd, new_left, new_top, new_right, new_bottom) in &others {
                            inner.last_positions.insert(
                                *other_hwnd,
                                (*new_left, *new_top, *new_right, *new_bottom),
                            );
                        }
                        inner.moving = false;
                    }
                } else {
                    if let Ok(mut inner) = state.inner.try_lock() {
                        inner.moving = false;
                    }
                }
            }

            DefSubclassProc(hwnd, msg, wparam, lparam)
        }

        WM_EXITSIZEMOVE => {
            // Refresh all positions after drag ends
            if let Ok(mut inner) = state.inner.try_lock() {
                inner.moving = false;
                if let Some(&group_id) = inner.hwnd_to_group.get(&(hwnd as isize)) {
                    let hwnds: Vec<isize> = inner
                        .groups
                        .get(&group_id)
                        .map(|m| m.iter().map(|gm| gm.hwnd).collect())
                        .unwrap_or_default();
                    for h in hwnds {
                        let mut rect: RECT = std::mem::zeroed();
                        if GetWindowRect(h as HWND, &mut rect) != 0 {
                            inner
                                .last_positions
                                .insert(h, (rect.left, rect.top, rect.right, rect.bottom));
                        }
                    }
                }
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }

        WM_NCLBUTTONDBLCLK => 0,
        WM_SYSCOMMAND if (wparam & 0xFFF0) == SC_MAXIMIZE as usize => 0,

        WM_DESTROY => {
            // Auto-remove from group on window close
            let dissolved = if let Ok(mut inner) = state.inner.try_lock() {
                remove_hwnd_from_group(&mut inner, hwnd as isize)
            } else {
                Vec::new()
            };
            // Remove subclass from any remaining members whose group dissolved
            for other_hwnd in dissolved {
                RemoveWindowSubclass(other_hwnd as HWND, Some(subclass_proc), SUBCLASS_ID);
            }
            RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }

        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

// ---------------------------------------------------------------------------
// Screen clamping
// ---------------------------------------------------------------------------

/// Clamp a window rect so the top edge never goes above the monitor's work area.
/// Returns the adjusted (left, top) — width/height unchanged.
#[cfg(target_os = "windows")]
unsafe fn clamp_top_to_screen(left: i32, top: i32, right: i32, bottom: i32) -> (i32, i32) {
    let center_x = (left + right) / 2;
    let pt = POINT { x: center_x, y: top };
    let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
    if hmon.is_null() {
        return (left, top);
    }
    let mut mi: MONITORINFO = std::mem::zeroed();
    mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if GetMonitorInfoW(hmon, &mut mi) == 0 {
        return (left, top);
    }
    let work_top = mi.rcWork.top;
    let work_bottom = mi.rcWork.bottom;
    let work_left = mi.rcWork.left;
    let work_right = mi.rcWork.right;
    let w = right - left;
    let h = bottom - top;

    let mut new_left = left;
    let mut new_top = top;

    // Clamp top: title bar must stay on screen
    if new_top < work_top {
        new_top = work_top;
    }
    // Clamp bottom: at least the title bar (top 36px) must be visible
    if new_top > work_bottom - 36 {
        new_top = work_bottom - 36;
    }
    // Clamp left: at least 100px of window must be visible
    if new_left + w < work_left + 100 {
        new_left = work_left + 100 - w;
    }
    // Clamp right
    if new_left > work_right - 100 {
        new_left = work_right - 100;
    }
    let _ = (w, h); // suppress unused warnings

    (new_left, new_top)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Derive a stable isize ID from a label string (for non-Windows platforms).
#[cfg(not(target_os = "windows"))]
fn label_to_id(label: &str) -> isize {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    label.hash(&mut hasher);
    hasher.finish() as isize
}

/// Remove an HWND from its group. Returns HWNDs of any remaining members whose
/// group was dissolved (so the caller can remove their subclasses too).
fn remove_hwnd_from_group(inner: &mut GroupInner, hwnd: isize) -> Vec<isize> {
    let mut dissolved_hwnds = Vec::new();

    if let Some(group_id) = inner.hwnd_to_group.remove(&hwnd) {
        if let Some(members) = inner.groups.get_mut(&group_id) {
            members.retain(|m| m.hwnd != hwnd);
            if members.len() <= 1 {
                // Dissolve group — clean up ALL remaining members
                for remaining in members.iter() {
                    inner.hwnd_to_group.remove(&remaining.hwnd);
                    inner.last_positions.remove(&remaining.hwnd);
                    if inner.subclassed.remove(&remaining.hwnd) {
                        dissolved_hwnds.push(remaining.hwnd);
                    }
                }
                inner.groups.remove(&group_id);
            }
        }
    }
    inner.last_positions.remove(&hwnd);
    inner.subclassed.remove(&hwnd);

    dissolved_hwnds
}

/// Get the HWND for a Tauri webview window by label.
#[cfg(target_os = "windows")]
fn get_hwnd(app: &AppHandle, label: &str) -> Result<isize, String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;

    // Tauri v2 exposes HWND via the window's raw handle
    let hwnd = window.hwnd().map_err(|e| format!("Failed to get HWND: {e}"))?;
    Ok(hwnd.0 as isize)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn group_windows(
    app: AppHandle,
    labels: Vec<String>,
    state: State<'_, WindowGroupState>,
) -> Result<u32, String> {
    if labels.len() < 2 {
        return Err("Need at least 2 windows to form a group".to_string());
    }

    // Resolve all labels to HWNDs first
    #[cfg(target_os = "windows")]
    {
        let mut members: Vec<GroupMember> = Vec::new();
        for label in &labels {
            let hwnd = get_hwnd(&app, label)?;
            members.push(GroupMember {
                hwnd,
                label: label.clone(),
            });
        }

        let group_id;
        let hwnds_to_subclass: Vec<isize>;

        {
            let mut inner = state.inner.lock().unwrap();

            // Remove any of these HWNDs from existing groups
            for member in &members {
                if inner.hwnd_to_group.contains_key(&member.hwnd) {
                    remove_hwnd_from_group(&mut inner, member.hwnd);
                }
            }

            // Create new group
            inner.next_group_id += 1;
            group_id = inner.next_group_id;

            // Snapshot positions
            for member in &members {
                unsafe {
                    let mut rect: RECT = std::mem::zeroed();
                    if GetWindowRect(member.hwnd as HWND, &mut rect) != 0 {
                        inner.last_positions.insert(
                            member.hwnd,
                            (rect.left, rect.top, rect.right, rect.bottom),
                        );
                    }
                }
                inner.hwnd_to_group.insert(member.hwnd, group_id);
            }

            inner.groups.insert(group_id, members.clone());

            // Determine which HWNDs need subclassing
            hwnds_to_subclass = members
                .iter()
                .filter(|m| !inner.subclassed.contains(&m.hwnd))
                .map(|m| m.hwnd)
                .collect();

            for hwnd in &hwnds_to_subclass {
                inner.subclassed.insert(*hwnd);
            }
        }

        // Install subclass on the main thread
        if !hwnds_to_subclass.is_empty() {
            let state_ptr = &*state as *const WindowGroupState as usize;
            app.run_on_main_thread(move || {
                for hwnd in hwnds_to_subclass {
                    unsafe {
                        SetWindowSubclass(
                            hwnd as HWND,
                            Some(subclass_proc),
                            SUBCLASS_ID,
                            state_ptr,
                        );
                    }
                }
            })
            .map_err(|e| format!("Failed to subclass windows: {e}"))?;
        }

        Ok(group_id)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On non-Windows, track group membership without subclassing.
        // The frontend handles snap positioning; we just maintain the group registry.
        let mut inner = state.inner.lock().unwrap();

        // Remove labels from any existing groups
        for label in &labels {
            // Use a fake hwnd derived from label hash for non-Windows tracking
            let fake_hwnd = label_to_id(label);
            if inner.hwnd_to_group.contains_key(&fake_hwnd) {
                remove_hwnd_from_group(&mut inner, fake_hwnd);
            }
        }

        inner.next_group_id += 1;
        let group_id = inner.next_group_id;

        let members: Vec<GroupMember> = labels
            .iter()
            .map(|label| GroupMember {
                hwnd: label_to_id(label),
                label: label.clone(),
            })
            .collect();

        for member in &members {
            inner.hwnd_to_group.insert(member.hwnd, group_id);
        }
        inner.groups.insert(group_id, members);

        let _ = app;
        Ok(group_id)
    }
}

#[tauri::command]
pub async fn ungroup_window(
    app: AppHandle,
    label: String,
    state: State<'_, WindowGroupState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = get_hwnd(&app, &label)?;
        let should_remove_subclass;
        let dissolved_hwnds;

        {
            let mut inner = state.inner.lock().unwrap();
            should_remove_subclass = inner.subclassed.contains(&hwnd);
            dissolved_hwnds = remove_hwnd_from_group(&mut inner, hwnd);
        }

        // Collect all HWNDs that need their group subclass removed
        let mut hwnds_to_unsubclass = dissolved_hwnds;
        if should_remove_subclass {
            hwnds_to_unsubclass.push(hwnd);
        }

        if !hwnds_to_unsubclass.is_empty() {
            app.run_on_main_thread(move || {
                for h in hwnds_to_unsubclass {
                    unsafe {
                        RemoveWindowSubclass(h as HWND, Some(subclass_proc), SUBCLASS_ID);
                    }
                }
            })
            .map_err(|e| format!("Failed to remove subclass: {e}"))?;
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let fake_hwnd = label_to_id(&label);
        let mut inner = state.inner.lock().unwrap();
        remove_hwnd_from_group(&mut inner, fake_hwnd);
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn ungroup_all(
    app: AppHandle,
    state: State<'_, WindowGroupState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnds: Vec<isize>;
        {
            let mut inner = state.inner.lock().unwrap();
            hwnds = inner.subclassed.drain().collect();
            inner.groups.clear();
            inner.hwnd_to_group.clear();
            inner.last_positions.clear();
            inner.moving = false;
        }

        if !hwnds.is_empty() {
            app.run_on_main_thread(move || {
                for hwnd in hwnds {
                    unsafe {
                        RemoveWindowSubclass(hwnd as HWND, Some(subclass_proc), SUBCLASS_ID);
                    }
                }
            })
            .map_err(|e| format!("Failed to remove subclasses: {e}"))?;
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut inner = state.inner.lock().unwrap();
        inner.groups.clear();
        inner.hwnd_to_group.clear();
        inner.last_positions.clear();
        inner.moving = false;
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn ungroup_group(
    app: AppHandle,
    group_id: u32,
    state: State<'_, WindowGroupState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnds_to_remove: Vec<isize>;
        {
            let mut inner = state.inner.lock().unwrap();
            if let Some(members) = inner.groups.remove(&group_id) {
                hwnds_to_remove = members
                    .iter()
                    .filter(|m| inner.subclassed.contains(&m.hwnd))
                    .map(|m| m.hwnd)
                    .collect();
                for member in &members {
                    inner.hwnd_to_group.remove(&member.hwnd);
                    inner.last_positions.remove(&member.hwnd);
                    inner.subclassed.remove(&member.hwnd);
                }
            } else {
                return Ok(()); // group doesn't exist — no-op
            }
        }

        if !hwnds_to_remove.is_empty() {
            app.run_on_main_thread(move || {
                for hwnd in hwnds_to_remove {
                    unsafe {
                        RemoveWindowSubclass(hwnd as HWND, Some(subclass_proc), SUBCLASS_ID);
                    }
                }
            })
            .map_err(|e| format!("Failed to remove subclasses: {e}"))?;
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut inner = state.inner.lock().unwrap();
        if let Some(members) = inner.groups.remove(&group_id) {
            for member in &members {
                inner.hwnd_to_group.remove(&member.hwnd);
                inner.last_positions.remove(&member.hwnd);
            }
        }
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn list_groups(
    state: State<'_, WindowGroupState>,
) -> Result<Vec<GroupInfo>, String> {
    let inner = state.inner.lock().unwrap();
    let groups = inner
        .groups
        .iter()
        .map(|(&group_id, members)| GroupInfo {
            group_id,
            labels: members.iter().map(|m| m.label.clone()).collect(),
        })
        .collect();
    Ok(groups)
}

// ---------------------------------------------------------------------------
// Per-window setup subclass (installed on ALL windows)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
const SETUP_SUBCLASS_ID: usize = 0x4F56_0002;

/// Per-window subclass that:
/// - Blocks double-click maximize (WM_NCLBUTTONDBLCLK)
/// - Emits "window:drag-end" Tauri event on WM_EXITSIZEMOVE
#[cfg(target_os = "windows")]
unsafe extern "system" fn setup_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    match msg {
        WM_NCLBUTTONDBLCLK => 0,
        WM_SYSCOMMAND if (wparam & 0xFFF0) == SC_MAXIMIZE as usize => 0,
        WM_EXITSIZEMOVE => {
            // Emit drag-end event so the frontend can commit snaps
            let app_ptr = ref_data as *const AppHandle;
            if !app_ptr.is_null() {
                let app = &*app_ptr;
                let _ = app.emit("window:drag-end", ());
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }
        WM_DESTROY => {
            // Clean up the leaked AppHandle box
            if ref_data != 0 {
                let _ = Box::from_raw(ref_data as *mut AppHandle);
            }
            RemoveWindowSubclass(hwnd, Some(setup_subclass_proc), SETUP_SUBCLASS_ID);
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

/// Set up a window: strip WS_MAXIMIZEBOX + install subclass for drag-end events.
#[tauri::command]
pub async fn prevent_maximize(
    app: AppHandle,
    label: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = get_hwnd(&app, &label)?;
        // Box the AppHandle so the subclass can emit events
        let app_box = Box::new(app.clone());
        let app_ptr = Box::into_raw(app_box) as usize;

        app.run_on_main_thread(move || {
            unsafe {
                // Strip maximize style
                let style = GetWindowLongW(hwnd as HWND, GWL_STYLE);
                SetWindowLongW(hwnd as HWND, GWL_STYLE, style & !(WS_MAXIMIZEBOX as i32));

                // Install subclass for drag-end + double-click block
                SetWindowSubclass(
                    hwnd as HWND,
                    Some(setup_subclass_proc),
                    SETUP_SUBCLASS_ID,
                    app_ptr,
                );
            }
        })
        .map_err(|e| format!("Failed to set up window: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}
