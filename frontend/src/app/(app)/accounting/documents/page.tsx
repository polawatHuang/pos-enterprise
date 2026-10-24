import { redirect } from "next/navigation";

/** The documents list grew into the documents hub (ศูนย์เอกสาร); old links land on its sales tab. */
export default function DocumentsPage() {
  redirect("/documents?category=sales");
}
