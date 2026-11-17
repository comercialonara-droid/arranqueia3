import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="light"
    position="top-center"
    className="toaster group"
    toastOptions={{ classNames: { toast: "font-sans !rounded-md !border-border" } }}
    {...props}
  />
)

export { Toaster }
