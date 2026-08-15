import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import dotenv from 'dotenv'
import { beforeAll, describe, expect, it } from 'vitest'

import { fetchR2Image, isR2Enabled, r2Config, uploadR2Image } from './r2'

const IMAGE_PATH = 'outputs/images/raw/nsfw-app-anime_00001_.png'
const JOB_ID = 'nsfw-app-anime_00001_'
const OBJECT_KEY = 'nsfw-app-anime_00001_.png'

// Live integration test: only runs with R2_LIVE=1 so `npm test` stays
// hermetic. Credentials come from .env.vercel (R2_* vars).
describe.skipIf(process.env.R2_LIVE !== '1')(
  'live R2 upload using .env.vercel',
  () => {
    beforeAll(() => {
      dotenv.config({ path: '.env.vercel', override: true })
      process.env.R2_ENABLED = 'true'
    })

    it('uploads the PNG to the nfsw bucket under its own name', async () => {
      const image = readFileSync(IMAGE_PATH)
      expect(image.length).toBeGreaterThan(0)
      expect(r2Config().bucket).toBe('nfsw')
      expect(isR2Enabled()).toBe(true)

      await uploadR2Image(JOB_ID, image, OBJECT_KEY)

      const stored = await fetchR2Image(JOB_ID, OBJECT_KEY)
      expect(stored).not.toBeNull()
      expect((stored as Buffer).equals(image)).toBe(true)
    })
  }
)
