import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { UploadForm } from "@/components/community/upload-form";
import { MyUploads } from "@/components/community/my-uploads";
import { BookUp, LibraryBig, type LucideIcon, ShieldCheck } from "lucide-react";

type Tab = "upload" | "manage";

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "upload", label: "Upload", icon: BookUp },
  { value: "manage", label: "My uploads", icon: LibraryBig },
];

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

function UploadPage() {
  const [tab, setTab] = useState<Tab>("upload");

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight">Contribute</h1>
        <p className="text-muted-foreground text-base sm:text-lg">
          Share books with the{" "}
          <Link to="/community" className="text-primary underline-offset-4 hover:underline">
            Community library
          </Link>{" "}
          — and manage the ones you've uploaded.
        </p>
      </div>

      <SlidingTabs
        value={tab}
        onValueChange={setTab}
        options={TABS}
        className="glass w-fit rounded-2xl p-1"
        indicatorClassName="rounded-xl bg-primary shadow-sm"
        tabClassName="gap-2 rounded-xl px-4 py-2 text-sm"
        activeTabClassName="text-white"
      />

      <div key={tab} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out">
        {tab === "upload" ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
            <UploadForm />
            <p className="text-muted-foreground flex items-center gap-2 text-xs">
              <ShieldCheck className="h-3.5 w-3.5" />
              Please only upload books you have the right to share.
            </p>
          </div>
        ) : (
          <MyUploads />
        )}
      </div>
    </div>
  );
}
