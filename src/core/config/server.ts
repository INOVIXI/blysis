// Server configuration defaults - fallbacks when DB settings are not yet loaded.
// Components should prefer useSiteSettings() values over these.
// For initial setup, configure via Admin > Settings or environment variables.
export const serverConfig = {
    name: process.env.SITE_NAME || "Blysis",
    communityUrl: process.env.COMMUNITY_URL || "",
    description: process.env.SITE_DESCRIPTION || "",
    email: process.env.SITE_EMAIL || "",
    social: {
        facebook: process.env.SOCIAL_FACEBOOK || "",
        instagram: process.env.SOCIAL_INSTAGRAM || "",
        twitter: process.env.SOCIAL_TWITTER || "",
        youtube: process.env.SOCIAL_YOUTUBE || "",
    },
};
