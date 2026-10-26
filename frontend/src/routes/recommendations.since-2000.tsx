import { createFileRoute } from "@tanstack/react-router";
import { RecommendationListPage } from "@/components/recommendations/recommendation-list-page";

export const Route = createFileRoute("/recommendations/since-2000")({
  component: () => <RecommendationListPage id="since-2000" />,
});
