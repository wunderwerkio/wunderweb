export interface BridgeOptions {
	/** Origins of the editor the page may talk to (never "*"). */
	origins: string[];
}

export declare function mountBridge(opts: BridgeOptions): void;
