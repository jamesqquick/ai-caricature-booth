import { bindings, defineConfig, exports } from "cf/config";

const DATABASE_ID = "9524d781-e607-4d24-a432-a751005e2781";

export default defineConfig({
	accountId: "e9bc21da719562a3e45d77de7dd042de",
	worker: {
		name: "ai-caricature-booth-v2",
		compatibilityDate: "2026-08-13",
		entrypoint: "src/worker.ts",
		exports: {
			CaricatureWorkflow: exports.workflow({
				name: "caricature-generation",
			}),
		},
		observability: {
			enabled: true,
			logs: {
				headSamplingRate: 1,
			},
		},
		assets: {
			runWorkerFirst: [
				"/mcp",
				"/admin",
				"/admin/*",
				"/api/admin",
				"/api/admin/*",
			],
		},
		env: {
			ACCESS_AUD: bindings.text("f62b95fcf95dce07fb61b7d64381fc36317d10aca666a829c095745c07f83972"),
			ACCESS_TEAM_DOMAIN: bindings.text("https://cfcommunity.cloudflareaccess.com"),
			MCP_AUTH_TOKEN: bindings.secret(),
			PRINT_AGENT_TOKEN: bindings.secret(),
			PRINT_CAPABILITY_SECRET: bindings.secret(),
			REPLICATE_API_TOKEN: bindings.secret(),
			DB: bindings.d1({
				name: "ai-caricature-booth-db",
				id: DATABASE_ID,
			}),
			FEATURED_DB: bindings.d1({
				name: "ai-caricature-booth-db",
				id: DATABASE_ID,
				dev: {
					remote: true,
				},
			}),
			SELFIES: bindings.r2({
				name: "ai-caricature-booth-selfies",
			}),
			FEATURED_SELFIES: bindings.r2({
				name: "ai-caricature-booth-selfies",
				dev: {
					remote: true,
				},
			}),
			AI: bindings.ai({}),
			IMAGES: bindings.images({
				dev: {
					remote: true,
				},
			}),
			CARICATURE_WORKFLOW: bindings.workflow({
				name: "caricature-generation",
				worker: "ai-caricature-booth-v2",
				exportName: "CaricatureWorkflow",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
