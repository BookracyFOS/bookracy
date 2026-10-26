import { createFileRoute } from "@tanstack/react-router";
import { ReadingOrderPage } from "@/components/recommendations/reading-order-page";

export const Route = createFileRoute("/recommendations/marvel")({
  component: () => <ReadingOrderPage franchise="marvel" />,
});
