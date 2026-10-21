import type { AccDocument } from "@/lib/types";
import { formatThaiDate } from "@/lib/utils";
import { DOC_TYPE_LABEL } from "./labels";
import { useTaxSettings } from "@/lib/tax";

const n2 = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const branchLabel = (no?: string) => (!no || no === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${no}`);

/**
 * A4 document as printed/saved to PDF from the browser. Always black on white regardless of
 * theme, because this is what the customer receives.
 */
export function DocumentPaper({ doc }: { doc: AccDocument }) {
  const { tax } = useTaxSettings();
  if (doc.docType === "wht_certificate") return <WhtCertificate doc={doc} />;
  const org = doc.org;
  const isTax = doc.docType === "tax_invoice" || doc.docType === "tax_invoice_receipt" || doc.docType === "credit_note";
  return (
    <article className="print-a4 relative mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-black/5 sm:p-12">
      {doc.status === "void" && <Stamp text="ยกเลิก" />}
      {doc.isDraft && <Stamp text="ฉบับร่าง" muted />}
      <header className="flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div className="max-w-sm">
          <p className="text-lg font-bold">{org?.legalName || org?.name}</p>
          {org?.address && <p>{org.address}</p>}
          {org?.taxId && (
            <p>
              เลขประจำตัวผู้เสียภาษี {org.taxId} ({branchLabel(org.branchNo)})
            </p>
          )}
          {(org?.phone || org?.email) && <p>{[org?.phone && `โทร ${org.phone}`, org?.email].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xl font-bold">{DOC_TYPE_LABEL[doc.docType]}</p>
          {isTax && <p className="text-xs">ต้นฉบับ (เอกสารออกเป็นชุด)</p>}
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-start gap-x-4 sm:justify-end">
            <dt className="text-neutral-500">เลขที่</dt>
            <dd className="font-semibold">{doc.isDraft ? "—" : doc.docNo}</dd>
            <dt className="text-neutral-500">วันที่</dt>
            <dd>{formatThaiDate(doc.docDate)}</dd>
            {doc.dueDate && (
              <>
                <dt className="text-neutral-500">{doc.docType === "quotation" ? "ยืนราคาถึง" : "ครบกำหนด"}</dt>
                <dd>{formatThaiDate(doc.dueDate)}</dd>
              </>
            )}
            {doc.refDocNo && (
              <>
                <dt className="text-neutral-500">อ้างอิง</dt>
                <dd>{doc.refDocNo}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="mt-6 rounded-md border border-neutral-300 p-4">
        <p className="text-xs text-neutral-500">{doc.docType === "quotation" ? "เรียน" : "ลูกค้า / ผู้ซื้อ"}</p>
        <p className="font-semibold">{doc.partyName || "—"}</p>
        {doc.partyAddress && <p>{doc.partyAddress}</p>}
        {doc.partyTaxId && <p>เลขประจำตัวผู้เสียภาษี {doc.partyTaxId}</p>}
      </section>

      <table className="mt-6 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
            <th className="w-10 px-2 py-2 font-semibold">#</th>
            <th className="px-2 py-2 font-semibold">รายการ</th>
            <th className="w-20 px-2 py-2 text-right font-semibold">จำนวน</th>
            <th className="w-28 px-2 py-2 text-right font-semibold">ราคา/หน่วย</th>
            <th className="w-24 px-2 py-2 text-right font-semibold">ส่วนลด</th>
            <th className="w-32 px-2 py-2 text-right font-semibold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => (
            <tr key={it.id ?? i} className="border-b border-neutral-200 align-top">
              <td className="px-2 py-2">{i + 1}</td>
              <td className="px-2 py-2">
                {it.description}
                {it.vatType !== "vat7" && <span className="ml-1 text-xs text-neutral-500">({it.vatType === "exempt" ? "ยกเว้น VAT" : "VAT 0%"})</span>}
              </td>
              <td className="px-2 py-2 text-right">{it.quantity.toLocaleString("th-TH")}</td>
              <td className="px-2 py-2 text-right">{n2(it.unitPrice)}</td>
              <td className="px-2 py-2 text-right">{it.discount ? n2(it.discount) : "-"}</td>
              <td className="px-2 py-2 text-right">{n2(it.lineTotal ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex flex-col-reverse gap-6 sm:flex-row sm:justify-between">
        <div className="max-w-sm">
          <p className="rounded-md bg-neutral-100 px-3 py-2 font-semibold">({doc.amountText})</p>
          {doc.note && <p className="mt-3 whitespace-pre-line text-xs text-neutral-600">หมายเหตุ: {doc.note}</p>}
          {org?.bankAccount && (doc.docType === "quotation" || doc.docType === "invoice" || doc.docType === "tax_invoice") && (
            <div className="mt-3 rounded-md border border-neutral-300 px-3 py-2 text-xs">
              <p className="font-semibold">ชำระเงินโดยโอนเข้าบัญชี</p>
              <p>
                {org.bankAccount.bank} · {org.bankAccount.type} · เลขที่ {org.bankAccount.display ?? org.bankAccount.number}
              </p>
              <p>ชื่อบัญชี {org.bankAccount.name}</p>
            </div>
          )}
        </div>
        <dl className="grid min-w-64 grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt>รวมเป็นเงิน</dt>
          <dd className="text-right">{n2(doc.subtotal)}</dd>
          {doc.discount > 0 && (
            <>
              <dt>ส่วนลด</dt>
              <dd className="text-right">-{n2(doc.discount)}</dd>
            </>
          )}
          {(org?.vatRegistered ?? true) && (
            <>
              <dt>ยอดก่อนภาษีมูลค่าเพิ่ม</dt>
              <dd className="text-right">{n2(doc.total - doc.vatAmount)}</dd>
              <dt>ภาษีมูลค่าเพิ่ม {tax.vatRate}%</dt>
              <dd className="text-right">{n2(doc.vatAmount)}</dd>
            </>
          )}
          <dt className="border-t border-neutral-400 pt-1 font-bold">จำนวนเงินรวมทั้งสิ้น</dt>
          <dd className="border-t border-neutral-400 pt-1 text-right font-bold">{n2(doc.total)}</dd>
        </dl>
      </section>

      <footer className="mt-16 grid grid-cols-2 gap-10 text-center text-xs">
        <Signature label={doc.docType === "quotation" ? "ผู้อนุมัติซื้อ" : "ผู้รับสินค้า/บริการ"} />
        <Signature label={doc.status === "paid" ? "ผู้รับเงิน" : "ผู้มีอำนาจลงนาม"} />
      </footer>
    </article>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="mx-auto mb-2 h-10 w-48 border-b border-dotted border-neutral-500" />
      <p>{label}</p>
      <p className="mt-1 text-neutral-500">วันที่ ......../......../........</p>
    </div>
  );
}

function Stamp({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute right-10 top-28 rotate-[-12deg] rounded-lg border-4 px-5 py-1 text-3xl font-bold ${
        muted ? "border-neutral-300 text-neutral-300" : "border-red-500/70 text-red-500/70"
      }`}
    >
      {text}
    </div>
  );
}

/** Simplified 50 ทวิ layout (Revenue Code section 50 bis) with the fields a payee needs. */
function WhtCertificate({ doc }: { doc: AccDocument }) {
  const org = doc.org;
  const src = doc.whtSource;
  return (
    <article className="print-a4 relative mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-black/5 sm:p-12">
      {doc.status === "void" && <Stamp text="ยกเลิก" />}
      <p className="text-center text-lg font-bold">หนังสือรับรองการหักภาษี ณ ที่จ่าย</p>
      <p className="text-center text-xs">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
      <p className="mt-2 text-right">เลขที่ {doc.docNo}</p>
      <section className="mt-4 space-y-4">
        <Box title="ผู้มีหน้าที่หักภาษี ณ ที่จ่าย">
          <p className="font-semibold">{org?.legalName || org?.name}</p>
          <p>เลขประจำตัวผู้เสียภาษีอากร {org?.taxId ?? "—"}</p>
          <p>{org?.address}</p>
        </Box>
        <Box title="ผู้ถูกหักภาษี ณ ที่จ่าย">
          <p className="font-semibold">{doc.partyName ?? "—"}</p>
          <p>เลขประจำตัวผู้เสียภาษีอากร {doc.partyTaxId ?? "—"}</p>
          <p>
            ยื่นรวมในแบบ:{" "}
            <b>{src?.counterpartyType === "individual" ? "ภ.ง.ด.3" : "ภ.ง.ด.53"}</b>
          </p>
        </Box>
      </section>
      <table className="mt-6 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
            <th className="px-2 py-2 font-semibold">ประเภทเงินได้ที่จ่าย</th>
            <th className="px-2 py-2 font-semibold">วันที่จ่าย</th>
            <th className="px-2 py-2 text-right font-semibold">จำนวนเงินที่จ่าย</th>
            <th className="px-2 py-2 text-right font-semibold">ภาษีที่หักและนำส่งไว้</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-200">
            <td className="px-2 py-2">
              มาตรา {src?.incomeType ?? "40(8)"} ({src?.rate ?? "-"}%)
            </td>
            <td className="px-2 py-2">{src ? formatThaiDate(src.paidDate) : formatThaiDate(doc.docDate)}</td>
            <td className="px-2 py-2 text-right">{n2(doc.subtotal)}</td>
            <td className="px-2 py-2 text-right">{n2(doc.whtAmount)}</td>
          </tr>
          <tr className="font-bold">
            <td className="px-2 py-2" colSpan={2}>
              รวม
            </td>
            <td className="px-2 py-2 text-right">{n2(doc.subtotal)}</td>
            <td className="px-2 py-2 text-right">{n2(doc.whtAmount)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 font-semibold">ภาษีที่หักนำส่ง (ตัวอักษร): {doc.amountText}</p>
      <p className="mt-4 text-xs">ผู้จ่ายเงิน: (✓) หัก ณ ที่จ่าย</p>
      <p className="mt-1 text-xs">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</p>
      <footer className="mt-16 flex justify-end text-center text-xs">
        <Signature label="ผู้มีหน้าที่หักภาษี ณ ที่จ่าย" />
      </footer>
    </article>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-neutral-300 p-4">
      <p className="mb-1 text-xs text-neutral-500">{title}</p>
      {children}
    </div>
  );
}
