import { createFileRoute } from "@tanstack/react-router";
import { RecommendationListPage } from "@/components/recommendations/recommendation-list-page";

export const Route = createFileRoute("/recommendations/readers-favorites")({
  component: () => <RecommendationListPage id="readers-favorites" />,
});
