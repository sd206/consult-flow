import { Document, Image, Page, StyleSheet, Text, View, type Styles } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type { InvoiceDocumentData } from './view-model'

const GREY = '#6B7280'
const RULE = '#E5E7EB'

type TextStyle = Styles[string]
type Scale = { base: number; small: number; title: number; pad: number; gap: number; row: number }
const SCALES: Record<InvoiceDocumentData['layout'], Scale> = {
  classic: { base: 10, small: 9, title: 24, pad: 48, gap: 16, row: 6 },
  modern: { base: 10, small: 9, title: 24, pad: 48, gap: 16, row: 6 },
  compact: { base: 8.5, small: 7.5, title: 18, pad: 32, gap: 10, row: 3 },
}

function TextLines({ items, style }: { items: string[]; style: TextStyle }) {
  return (
    <>
      {items.map((t, i) => (
        <Text key={i} style={style}>
          {t}
        </Text>
      ))}
    </>
  )
}

function Cell({ w, align, bold, children }: { w: number; align?: 'right'; bold?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexGrow: w, flexBasis: 0, paddingRight: 6 }}>
      <Text style={{ textAlign: align ?? 'left', fontFamily: bold ? 'Helvetica-Bold' : 'Helvetica' }}>{children}</Text>
    </View>
  )
}

/* eslint-disable jsx-a11y/alt-text -- react-pdf's Image is not an HTML img and has no alt prop */
export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const s = SCALES[data.layout]
  const modern = data.layout === 'modern'
  const accent = data.accentColor
  const headText = modern ? '#FFFFFF' : '#111827'
  const headMuted = modern ? '#FFFFFF' : GREY

  const st = StyleSheet.create({
    page: { fontFamily: 'Helvetica', fontSize: s.base, color: '#111827', paddingBottom: s.pad + 16 },
    body: { paddingHorizontal: s.pad, paddingTop: s.gap },
    head: modern
      ? { backgroundColor: accent, paddingHorizontal: s.pad, paddingTop: s.pad, paddingBottom: s.gap + 4 }
      : {
          paddingHorizontal: s.pad,
          paddingTop: s.pad,
          paddingBottom: s.gap,
          borderBottomWidth: 2,
          borderBottomColor: accent,
        },
    headRow: { flexDirection: 'row', justifyContent: 'space-between' },
    title: { fontSize: s.title, fontFamily: 'Helvetica-Bold', color: modern ? '#FFFFFF' : accent, textAlign: 'right' },
    firmName: { fontFamily: 'Helvetica-Bold', fontSize: s.base + 2, color: headText },
    headLine: { fontSize: s.small, color: headMuted },
    label: { fontSize: s.small, color: GREY, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    meta: { fontSize: s.small, color: headMuted, textAlign: 'right' },
    metaBold: { fontSize: s.base, color: headText, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
    thead: { flexDirection: 'row', paddingVertical: s.row, borderBottomWidth: 1, borderBottomColor: accent },
    row: { flexDirection: 'row', paddingVertical: s.row, borderBottomWidth: 1, borderBottomColor: RULE },
    totals: { alignSelf: 'flex-end', width: '50%', marginTop: s.gap },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
    grand: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
      marginTop: 2,
      borderTopWidth: 1,
      borderTopColor: accent,
      fontFamily: 'Helvetica-Bold',
    },
    footer: {
      position: 'absolute',
      bottom: s.pad / 2,
      left: s.pad,
      right: s.pad,
      fontSize: s.small,
      color: GREY,
      textAlign: 'center',
    },
  })

  const logo = data.from.logo
  const c = data.columns

  return (
    <Document title={data.number ?? 'Draft invoice'}>
      <Page size="A4" style={st.page}>
        <View style={st.head}>
          <View style={st.headRow}>
            <View style={{ maxWidth: '55%' }}>
              {logo ? (
                <Image
                  src={{ data: Buffer.from(logo.data), format: logo.format }}
                  style={{ maxHeight: 48, maxWidth: 140, objectFit: 'contain', objectPosition: 'left', marginBottom: 6 }}
                />
              ) : null}
              <Text style={st.firmName}>{data.from.name}</Text>
              <TextLines items={data.from.addressLines} style={st.headLine} />
              <TextLines items={data.from.contactLines} style={st.headLine} />
            </View>
            <View>
              <Text style={st.title}>{data.title}</Text>
              {data.number ? <Text style={st.metaBold}>{data.number}</Text> : null}
              <Text style={st.meta}>Issued: {data.issueDate}</Text>
              <Text style={st.meta}>Due: {data.dueDate}</Text>
              <Text style={st.meta}>Period: {data.period}</Text>
            </View>
          </View>
        </View>

        <View style={st.body}>
          <View style={{ marginBottom: s.gap }}>
            <Text style={st.label}>BILL TO</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{data.billTo.name}</Text>
            <TextLines items={data.billTo.addressLines} style={{ fontSize: s.small }} />
            <TextLines items={data.billTo.contactLines} style={{ fontSize: s.small, color: GREY }} />
          </View>

          {data.subject ? <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: s.gap }}>{data.subject}</Text> : null}

          <View style={st.thead}>
            {c.consultant ? <Cell w={2} bold>Consultant</Cell> : null}
            {c.project ? <Cell w={2} bold>Project</Cell> : null}
            <Cell w={4} bold>Description</Cell>
            {c.quantity ? <Cell w={1} align="right" bold>Qty</Cell> : null}
            {c.rate ? <Cell w={1.6} align="right" bold>Rate</Cell> : null}
            <Cell w={1.8} align="right" bold>Amount</Cell>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={st.row} wrap={false}>
              {c.consultant ? <Cell w={2}>{l.consultant}</Cell> : null}
              {c.project ? <Cell w={2}>{l.project}</Cell> : null}
              <Cell w={4}>{l.description}</Cell>
              {c.quantity ? <Cell w={1} align="right">{l.quantity}</Cell> : null}
              {c.rate ? <Cell w={1.6} align="right">{l.rate}</Cell> : null}
              <Cell w={1.8} align="right">{l.amount}</Cell>
            </View>
          ))}

          <View style={st.totals} wrap={false}>
            <View style={st.totalRow}>
              <Text>Subtotal</Text>
              <Text>{data.totals.subtotal}</Text>
            </View>
            {data.totals.discount ? (
              <View style={st.totalRow}>
                <Text>{data.totals.discountLabel}</Text>
                <Text>{data.totals.discount}</Text>
              </View>
            ) : null}
            <View style={st.totalRow}>
              <Text>{data.totals.taxLabel}</Text>
              <Text>{data.totals.tax}</Text>
            </View>
            <View style={st.grand}>
              <Text>Total</Text>
              <Text>{data.totals.total}</Text>
            </View>
          </View>

          <View style={{ marginTop: s.gap * 1.5 }} wrap={false}>
            <Text style={st.label}>PAYMENT TERMS</Text>
            <Text style={{ fontSize: s.small }}>{data.paymentTerms}</Text>
          </View>
        </View>

        {data.footer ? (
          <Text style={st.footer} fixed>
            {data.footer}
          </Text>
        ) : null}
      </Page>

      {data.detail ? (
        <Page size="A4" style={st.page}>
          <View style={{ paddingHorizontal: s.pad, paddingTop: s.pad }}>
            <Text style={{ ...st.title, fontSize: s.title - 6, textAlign: 'left', color: accent, marginBottom: s.gap }}>
              Hours detail
            </Text>
            <View style={st.thead}>
              <Cell w={1.6} bold>Date</Cell>
              <Cell w={2} bold>Consultant</Cell>
              <Cell w={2} bold>Project</Cell>
              <Cell w={1} align="right" bold>Hours</Cell>
              <Cell w={4} bold>Note</Cell>
            </View>
            {data.detail.map((d, i) => (
              <View key={i} style={st.row} wrap={false}>
                <Cell w={1.6}>{d.date}</Cell>
                <Cell w={2}>{d.consultant}</Cell>
                <Cell w={2}>{d.project}</Cell>
                <Cell w={1} align="right">{d.hours}</Cell>
                <Cell w={4}>{d.note}</Cell>
              </View>
            ))}
          </View>
          {data.footer ? (
            <Text style={st.footer} fixed>
              {data.footer}
            </Text>
          ) : null}
        </Page>
      ) : null}
    </Document>
  )
}
