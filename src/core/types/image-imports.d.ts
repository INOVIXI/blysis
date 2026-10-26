/**
 * A picture imported into code, as a theme's components import theirs.
 *
 * `next-env.d.ts` brings these types, and it is written by `next build` and
 * ignored by git. CI's type check runs before any build, so it found no type
 * for `@/themes/<id>/pictures/hero.jpg` while every local run, with a build
 * behind it, did.
 */
/// <reference types="next/image-types/global" />
