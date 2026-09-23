// app/api/docs/route.ts - P2-4 OpenAPI docs endpoint
import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const yamlPath = path.join(process.cwd(), "docs/openapi.yaml")
    const jsonPath = path.join(process.cwd(), "docs/openapi.json")

    let content: string
    let contentType: string

    if (fs.existsSync(jsonPath)) {
      content = fs.readFileSync(jsonPath, "utf-8")
      contentType = "application/json"
    } else if (fs.existsSync(yamlPath)) {
      content = fs.readFileSync(yamlPath, "utf-8")
      contentType = "text/yaml"
    } else {
      return NextResponse.json({ success: false, error: "OpenAPI spec not found" }, { status: 404 })
    }

    // If query ?format=json and yaml exists, try to convert (simple fallback returns yaml)
    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: "Failed to load docs" }, { status: 500 })
  }
}
