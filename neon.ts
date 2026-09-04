import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  branch: (branch) => {
    if (branch.exists || branch.isDefault) return {};

    if (branch.name.startsWith("dev-") || branch.name.startsWith("preview/")) {
      return {
        parent: "production",
        ttl: "7d",
        postgres: {
          computeSettings: {
            autoscalingLimitMinCu: 0.25,
            autoscalingLimitMaxCu: 1,
          },
        },
      };
    }

    return {};
  },
});
