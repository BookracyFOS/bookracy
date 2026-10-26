import { createFileRoute } from "@tanstack/react-router";
import { ReadingOrderPage } from "@/components/recommendations/reading-order-page";

export const Route = createFileRoute("/recommendations/dc")({
  component: () => <ReadingOrderPage franchise="dc" />,
});
