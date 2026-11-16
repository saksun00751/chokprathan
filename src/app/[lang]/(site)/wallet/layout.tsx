import { Provide } from "@/i18n/provide";

/** Wallet pages render client forms and lists that read the money namespace. */
export default function WalletLayout({ children }: LayoutProps<"/[lang]/wallet">) {
  return <Provide ns={["money"]}>{children}</Provide>;
}
