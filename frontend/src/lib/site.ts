const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://app.poswithai.com";

export const siteOrigin = new URL(configuredSiteUrl).origin;
export const siteUrl = new URL(siteOrigin);
