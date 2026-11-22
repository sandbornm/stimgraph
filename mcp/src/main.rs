use stimgraph_mcp::{serve, ServerConfig};

fn main() {
    let config = match ServerConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("stimgraph-mcp: {error}");
            std::process::exit(1);
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("stimgraph-mcp: {error}");
            std::process::exit(1);
        }
    };
    runtime.block_on(async move {
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
    });
}
