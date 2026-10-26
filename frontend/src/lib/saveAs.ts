export const saveAs = (url?: string, fileName?: string, openInNewTab = false) => {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;

  if (openInNewTab) {
    link.target = "_blank";
  } else {
    link.download = fileName || url.split("/").pop() || "download";
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
