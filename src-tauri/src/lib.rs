//! FlipStudio Pro desktop shell.
//!
//! The editor is the React app in `../dist`. This shell provides the native
//! window plus the two plugins the editor uses:
//! - `dialog`: native Open / Save As / Export file pickers
//! - `fs`: reading and writing the files chosen in those pickers
//! - `opener`: opening web links (published flipbooks, object links) in the default browser
//! - `http`: talking to the Cloudflare API (direct publishing), which browsers would block (CORS)

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running FlipStudio Pro");
}
