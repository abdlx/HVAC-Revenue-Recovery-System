import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

type RouteContext = { params: Promise<{ path: string[] }> };

export function GET(request: NextRequest, context: RouteContext) {
  return getAuth().handler().GET(request, context);
}
export function POST(request: NextRequest, context: RouteContext) {
  return getAuth().handler().POST(request, context);
}
export function PUT(request: NextRequest, context: RouteContext) {
  return getAuth().handler().PUT(request, context);
}
export function PATCH(request: NextRequest, context: RouteContext) {
  return getAuth().handler().PATCH(request, context);
}
export function DELETE(request: NextRequest, context: RouteContext) {
  return getAuth().handler().DELETE(request, context);
}
