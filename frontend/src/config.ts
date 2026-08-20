const configuredApiBase = import.meta.env.VITE_API_BASE?.trim();

export const API_BASE = (
  configuredApiBase && configuredApiBase.length > 0
    ? configuredApiBase
  : '/api'
).replace(/\/+$/, '');

const configuredCommunityUrl = import.meta.env.VITE_COMMUNITY_URL?.trim();

export const COMMUNITY_URL = configuredCommunityUrl && configuredCommunityUrl.length > 0
  ? configuredCommunityUrl
  : 'https://june.ai/community';
