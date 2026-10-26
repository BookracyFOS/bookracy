import { useSettingsStore } from "@/stores/settings";
import { ofetch } from "ofetch";

export type BaseResponse<T> = {
  results: T[];
};

const backendURL = useSettingsStore.getState().backendURL;

export const client = ofetch.create({
  baseURL: backendURL + `/api`,
});
