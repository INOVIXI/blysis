import { RATE_LIMIT_API, RATE_LIMIT_PROVIDER_CALLBACK } from "@/core/lib/constants";
import type { RateLimitConfig } from "@/core/lib/rate-limit";

/**
 * Which rate-limit bucket a module endpoint gets.
 *
 * Core's own routes each call the limiter themselves, which works because
 * there are ninety-seven of them and they all live in this repository. The
 * module surface is a hundred and sixty-five endpoints across fifty modules,
 * written by whoever wrote the module, and not one of them was limited: a
 * stranger could post to a form endpoint, a vote claim or a payment callback
 * as fast as the network allowed. Leaving it to each module to remember is
 * the bet that lost here, so the dispatcher applies this to all of them.
 *
 * A `providerCallback` gets a far higher ceiling than a browser endpoint: a
 * webhook throttled during a provider's burst delays a settlement, which is a
 * worse failure than the one the limit prevents. It is still a ceiling.
 */
export interface EndpointLimit {
    providerCallback?: boolean;
    rateLimit?: { maxRequests: number; windowMs: number };
}

/** Enough of a matched route to say which endpoint a request spent budget on. */
export interface BucketIdentity {
    module: string;
    handler?: string;
    key: string;
}

/**
 * Which endpoint a request counts against.
 *
 * Not the URL. A manifest declares `{ path, handler }` pairs and nothing stops
 * it declaring one handler at two paths, which fifteen of them do: one module
 * lists thirteen of its routes both bare and under a prefix of its own, and two
 * others list one twice each. The registry key is built from the path, so each
 * spelling opened its own budget and the ceiling on those endpoints was quietly
 * twice what it read as - measured on the demo, the prefixed spelling was
 * exhausted and thirty more requests to the bare one, from the same caller,
 * were all served.
 *
 * Two of them dispense value on request, `gift-codes/redeem` and `chest/[id]`,
 * and the dispatcher's whole reason for existing is that an endpoint may not
 * opt out of its limit. Keying on the handler makes an alias free: declare a
 * route under as many paths as you like, they share one budget.
 *
 * Falls back to the key for a route table generated before `handler` existed.
 */
export function bucketKeyFor(route: BucketIdentity): string {
    return route.handler ? `${route.module}:${route.handler}` : route.key;
}

export function defaultBucket(providerCallback?: boolean): RateLimitConfig {
    return providerCallback ? RATE_LIMIT_PROVIDER_CALLBACK : RATE_LIMIT_API;
}

/**
 * A manifest may only tighten. Fewer requests, or the same number spread over
 * a longer window - never more, and never off, because the reason core
 * enforces this at all is that an endpoint may not opt out of it.
 */
export function bucketFor(route: EndpointLimit): RateLimitConfig {
    const base = defaultBucket(route.providerCallback);
    if (!route.rateLimit) return base;
    return {
        maxRequests: Math.min(base.maxRequests, route.rateLimit.maxRequests),
        windowMs: Math.max(base.windowMs, route.rateLimit.windowMs),
    };
}

/** Requests per minute a bucket allows, for comparing two windows fairly. */
export function perMinute(config: RateLimitConfig): number {
    return (config.maxRequests * 60_000) / config.windowMs;
}
