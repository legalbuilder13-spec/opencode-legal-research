import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { legalWorkbenchUrl } from "@/utils/legal-workbench-url"

export default function LegalResearchPage() {
  const language = useLanguage()
  const platform = usePlatform()
  const workbench = legalWorkbenchUrl(import.meta.env.VITE_LEGAL_WORKBENCH_URL)

  return (
    <main class="flex h-full min-h-0 w-full flex-col bg-background-base">
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-border-weak-base px-5 py-3">
        <div class="min-w-0">
          <h1 class="text-16-medium text-text-strong">{language.t("legal.research.title")}</h1>
          <p class="truncate text-12-regular text-text-weak">{language.t("legal.research.description")}</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md border border-border-base px-3 py-1.5 text-12-medium text-text-base hover:bg-surface-raised-base-hover"
          onClick={() => platform.openExternal(workbench)}
        >
          {language.t("legal.research.openStandalone")}
        </button>
      </header>
      <iframe
        class="min-h-0 w-full flex-1 border-0 bg-background-base"
        src={workbench}
        title={language.t("legal.research.frameTitle")}
        sandbox="allow-downloads allow-forms allow-same-origin allow-scripts"
      />
    </main>
  )
}
