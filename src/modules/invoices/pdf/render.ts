import 'server-only'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { InvoiceDocument } from './document'
import type { InvoiceDocumentData } from './view-model'

export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(createElement(InvoiceDocument, { data }) as unknown as ReactElement<DocumentProps>)
  return new Uint8Array(buffer)
}
