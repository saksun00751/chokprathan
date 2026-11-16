import { getI18n, pageMeta } from "@/i18n/rsc";
import { ResetFlow } from "./reset-flow";

export const generateMetadata = () => pageMeta("forgot");

export default async function ForgotPasswordPage() {
  const { t } = await getI18n();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.reset.title}</h1>
      <p className="mt-1 text-ink-2">{t.auth.reset.subtitle}</p>
      <ResetFlow />
    </>
  );
}
