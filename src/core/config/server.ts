// Server configuration defaults - fallbacks when DB settings are not yet loaded.
// Components should prefer useSiteSettings() values over these.
// For initial setup, configure via Admin > Settings or environment variables.
export const serverConfig = {
    name: process.env.SITE_NAME || "Blysis",
    description: process.env.SITE_DESCRIPTION || "",
};
