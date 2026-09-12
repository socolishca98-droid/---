import { NextResponse } from 'next/server'
import { getCitiesList } from '@/lib/ati-client'

export async function GET() {
  const cities = getCitiesList()
  return NextResponse.json(cities)
}