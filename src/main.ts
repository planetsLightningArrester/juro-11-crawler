import { request } from 'gaxios'
import { program } from 'commander'
import { google } from 'googleapis'
import { Print, color } from 'printaeu'

const info = Print.create()
info.preAppend(`[${color.cyan}INFO${color.reset}] `)
info.showDate()
const err = Print.create()
err.preAppend(`[${color.red}ERRO${color.reset}] `)
err.showDate()

const spartaSpreadsheetId = '1Mw8ZeD2R2Y4j5t9sxJ-jH2vINRh_ZAx2zQpouM06x1o'
const googleFinanceHubSpreadsheetId = '12BhxOJb6QTRS1EqLk9PppEg2T6g7yRg-3MQNjDvc4xc'

async function main(): Promise<void> {
  program
    .name('juro-11-crawler')
    .description('Crawl JURO11 quota values and send emails')
    .requiredOption('-g, --google <credential>', 'Google API Credential Token')
    .requiredOption('-t, --telegram <token>', 'Telegram chat token')
    .requiredOption('-c, --chat <id>', 'Telegram chat ID')
    .parse()

  const googleCredential: string = program.opts().google
  const telegramToken: string = program.opts().telegram
  const chatId: string = program.opts().chat

  info.log('🏊 Crawling for market and asset value')
  const [assetQuotaDate, assetQuotaValue] = await getLastAssetQuotaValue(googleCredential)
  info.log(`🏦 Asset value: R$ ${assetQuotaValue.toString().replace('.', ',')} (${assetQuotaDate})`)
  const marketValue = await getLastAssetMarketValue(googleCredential)
  info.log(`💰 Asset market value: R$ ${marketValue.toString().replace('.', ',')}`)
  const ratio = (Math.abs(marketValue - assetQuotaValue) / assetQuotaValue)
  if (ratio < 0.02) {
    info.log(`📈 Market/asset ratio less than 2% (${(ratio * 100).toFixed(1)}%). Sending notification`)
    await sendTelegramMessage(telegramToken, chatId, assetQuotaValue, marketValue)
  } else {
    info.log(`📈 Market/asset ratio greater than 2% (${(ratio * 100).toFixed(1)}%)`)
  }

  info.log('🏁 Script is done')
}

async function getLastAssetQuotaValue(credential: string): Promise<[string, number]> {
  const sheets = google.sheets({ version: 'v4', auth: credential })

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spartaSpreadsheetId,
    range: 'Cota'
  })

  const rows = res.data.values
  if (!Array.isArray(rows) || rows.length === 0) {
    const message = `the spreadsheet '${spartaSpreadsheetId}' returned no data\n`
    err.log(message)
    throw new Error(message)
  } else {
    let lastQuotaDate = ''
    let lastQuotaValue = -1
    for (let i = rows.length - 1; i >= 0; i++) {
      const value = rows[i][4]
      const date = rows[i][1]
      if (typeof value === 'string') {
        const quotaCandidate = parseFloat(value.replace('.', '').replace(',', '.'))
        if (!isNaN(quotaCandidate)) {
          lastQuotaValue = quotaCandidate
          lastQuotaDate = date
          break
        }
      }
    }
    if (lastQuotaValue === -1 || lastQuotaDate === '') {
      const message = "couldn't get the last updated asset value. No fifth column can be converted to a number\n"
      err.log(message)
      throw Error(message)
    } else return [lastQuotaDate, lastQuotaValue]
  }
}

async function getLastAssetMarketValue(credential: string): Promise<number> {
  const sheets = google.sheets({ version: 'v4', auth: credential })

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: googleFinanceHubSpreadsheetId, range: 'AssetsPrice' })

  const rows = res.data.values
  if (!Array.isArray(rows) || rows.length === 0) {
    const message = `the spreadsheet '${googleFinanceHubSpreadsheetId}' returned no data\n`
    err.log(message)
    throw new Error(message)
  } else {
    let marketValue = -1
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (typeof row !== 'undefined') {
        const asset = row[0]
        const value = row[1]
        if (asset === 'JURO11' && typeof value === 'string') {
          const quotaCandidate = parseFloat(value.replace('R$', '').replace(',', ''))
          if (!isNaN(quotaCandidate)) {
            marketValue = quotaCandidate
            break
          }
        }
      }
    }
    if (marketValue === -1) {
      const message = "couldn't get the last updated market value. No first column matching JURO11\n"
      err.log(message)
      throw Error(message)
    } else return marketValue
  }
}

async function sendTelegramMessage(telegramToken: string, chatId: string, assetQuotaValue: number, marketValue: number): Promise<void> {
  const ratio = (Math.abs(marketValue - assetQuotaValue) / assetQuotaValue)
  await request({
    method: 'POST',
    url: `https://api.telegram.org/bot${telegramToken}/sendMessage`,
    data: {
      chat_id: chatId,
      parse_mode: 'MarkdownV2',
      text: `
*Atualizações do preço patrimonial de JURO11*

Valor da cota: R$ ${assetQuotaValue.toString().replace('.', ',')}
Valor de mercado: R$ ${marketValue.toString().replace('.', ',')}
Relação Mercado/Cota: *${(ratio * 100).toFixed(1).replace('.', ',')}%*
      `
    },
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

main().catch(console.log)
