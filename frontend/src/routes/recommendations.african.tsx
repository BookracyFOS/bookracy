import { createFileRoute } from "@tanstack/react-router";
import { RecommendationListPage } from "@/components/recommendations/recommendation-list-page";

export const Route = createFileRoute("/recommendations/african")({
  component: () => <RecommendationListPage id="african" />,
});
