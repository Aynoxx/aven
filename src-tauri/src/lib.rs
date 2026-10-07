use serde_json::{json, Value};

#[tauri::command]
fn aven_call(method: String, _args: Vec<Value>) -> Result<Value, String> {
    match method.as_str() {
        // Premier jalon volontairement limité : le shell Tauri sait démarrer React
        // et exposer le même contrat API, mais le runtime Node n'est pas encore branché.
        "state" => Ok(json!({
            "status": "error",
            "error": "Le shell Tauri fonctionne, mais le runtime Aven Node n'est pas encore connecté.",
            "keys": {},
            "providers": [],
            "updatesConfigured": false
        })),
        "freebuffPtyActive" => Ok(json!(false)),
        "freebuffCliStatus" => Ok(json!({ "installed": false })),
        "prefs" => Ok(json!({ "notifications": true, "freebuffResume": false })),
        _ => Err(format!("Méthode Aven non branchée dans Tauri : {method}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![aven_call])
        .run(tauri::generate_context!())
        .expect("error while running Aven");
}
