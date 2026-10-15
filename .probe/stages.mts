import { buildRouteStages } from "../lib/eta/trip"
const stages = buildRouteStages([
  { id: "o1", routeFrom: "Ярославль", routeTo: "Москва", routeSequence: 1 },
], { origin: { point: { lat: 57.62, lng: 39.89 }, address: "База" } })
for (const [i, s] of stages.entries()) console.log(i, s.kind, s.address ?? "-", s.orderId ?? "-")
