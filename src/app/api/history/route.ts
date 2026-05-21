import { NextResponse } from 'next/server'

import { listHistory } from '@/lib/output-store'

export async function GET() {
  const items = await listHistory(50)
  return NextResponse.json({ items })
}
