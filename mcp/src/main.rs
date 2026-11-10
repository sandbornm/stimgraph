use stimgraph_mcp::{serve, ServerConfig};

#[tokio::main]
async fn main() {
    let config = match ServerConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("stimgraph-mcp: {error}");
            std::process::exit(1);
        }
    };
    let running = match serve(config).await {
        Ok(running) => running,
        Err(error) => {
            eprintln!("stimgraph-mcp: {error}");
            std::process::exit(1);
        }
    };
    eprintln!("stimgraph-mcp listening on http://{}/mcp", running.addr);
    let _ = tokio::signal::ctrl_c().await;
    running.shutdown().await;
}
