import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
DATA = json.loads((ROOT/'data'/'recalls.json').read_text(encoding='utf-8'))

def norm_gtin(v):
    digits = re.sub(r'\D','',str(v or ''))
    return digits[1:] if len(digits)==14 and digits.startswith('0') else digits

def norm_lot(v):
    return re.sub(r'\s+','',str(v or '').strip().upper())

def to_iso(y,m,d):
    y,m,d=int(y),int(m),int(d)
    if not y or m<1 or m>12 or d<1 or d>31: return ''
    return f'{y:04d}-{m:02d}-{d:02d}'

def norm_date(v):
    if not v: return ''
    s=str(v).strip()
    if re.match(r'^20\d{2}-\d{2}-\d{2}$',s): return s
    m=re.search(r'(20\d{2})[./\-年 ]?(\d{1,2})[./\-月 ]?(\d{1,2})',s)
    if m: return to_iso(*m.groups())
    m=re.search(r'(20\d{2})(\d{2})(\d{2})',s)
    if m: return to_iso(*m.groups())
    m=re.search(r'(?:^|\D)(\d{2})(\d{2})(\d{2})(?:\D|$)',s)
    if m: return to_iso(2000+int(m.group(1)),m.group(2),m.group(3))
    return ''

def norm_text(s):
    s=str(s or '').lower().replace('臺','台')
    return re.sub(r'[\s\u3000\-_/\\|:：;；,，.。()（）\[\]【】{}]','',s)

def product_keywords(p):
    return [x for x in [p.get('company_name'),p.get('brand_name'),p.get('product_name'),p.get('category'),*(p.get('product_name_aliases') or p.get('keywords') or [])] if x]

def find_barcode(code):
    c=norm_gtin(code)
    return next((p for p in DATA['products'] if norm_gtin(p.get('barcode_gtin'))==c and c), None)

def find_name(text):
    hay=norm_text(text)
    best=None
    for p in DATA['products']:
        score=0
        if norm_text(p.get('product_name')) in hay and norm_text(p.get('product_name')):
            score+=8
        for kw in product_keywords(p):
            k=norm_text(kw)
            if k and k in hay:
                score+=min(4,max(1,(len(k)+2)//3))
        if best is None or score>best[0]: best=(score,p)
    return best[1] if best and best[0]>=4 else None

def batch_matches(batch, lot, expiry):
    bl=norm_lot(batch.get('lot_no'))
    be=norm_date(batch.get('expiry_date')) or batch.get('expiry_date')
    lm = bool(bl and lot == bl)
    em = bool(be and expiry == be)
    if bl and be: return lm and em
    return lm or em

def evaluate(barcode='', name='', lot='', expiry=''):
    lot=norm_lot(lot); expiry=norm_date(expiry) or expiry
    p=find_barcode(barcode) if barcode else None
    by='barcode' if p else ''
    if not p and name:
        p=find_name(name); by='name' if p else ''
    if not barcode and not name and not lot and not expiry: return '待掃描', by
    if not p: return '無資料', by
    batches=p.get('affected_batches') or []
    for b in batches:
        if b.get('affects_all') is True or (not norm_lot(b.get('lot_no')) and not b.get('expiry_date')):
            return '不合格', by
    for b in batches:
        if batch_matches(b,lot,expiry): return '不合格', by
    if batches and not lot and not expiry: return '需確認', by
    return '合格', by

def parse_gs1(raw):
    s=str(raw or '').strip().replace('[','').replace(']','').replace('{','').replace('}','')
    out={}
    m=re.search(r'\(01\)\s*(\d{14})',s)
    if m: out['gtin']=norm_gtin(m.group(1))
    m=re.search(r'\(17\)\s*(\d{6})',s) or re.search(r'\(15\)\s*(\d{6})',s)
    if m: out['expiry']=to_iso(2000+int(m.group(1)[:2]),m.group(1)[2:4],m.group(1)[4:6])
    return out

def parse_ocr(text):
    compact=str(text or '').replace('Ｏ','0').replace('O','0').replace('I','1').replace('l','1').upper()
    out={'productText':text}
    for pat in [r'(?:EXP|有效|效期|期限|保存期限)[^0-9]{0,12}(20\d{2})[./\-年 ]?(\d{1,2})[./\-月 ]?(\d{1,2})',r'(20\d{2})[./\-年 ]?(\d{1,2})[./\-月 ]?(\d{1,2})']:
        m=re.search(pat,compact)
        if m:
            out['expiry']=to_iso(*m.groups()); break
    m=re.search(r'(?:LOT|批號|批号|批次)[^A-Z0-9]{0,8}([A-Z0-9][A-Z0-9\-.]{2,24})',compact)
    if m: out['lot']=norm_lot(m.group(1))
    return out

tests=[]
def add(name, got, expected):
    tests.append({'case':name,'got':got,'expected':expected,'pass':got==expected})

add('資料 schema', isinstance(DATA.get('products'), list) and bool(DATA.get('metadata')), True)
add('問題條碼但缺效期', evaluate(barcode='4712867148851')[0], '需確認')
add('問題條碼 + 問題效期', evaluate(barcode='4712867148851', expiry='20270408')[0], '不合格')
add('問題條碼 + 非問題效期', evaluate(barcode='4712867148851', expiry='20270409')[0], '合格')
add('品名 + 問題效期', evaluate(name='蔥阿伯 優選水餃 高麗菜豬肉', expiry='2027/04/08')[0], '不合格')
add('官方無條碼品名 + 批號 + 效期', evaluate(name='中聯油脂 大豆沙拉油', lot='315-1150404', expiry='2026-09-30')[0], '不合格')
add('未收錄條碼', evaluate(barcode='4710105037103')[0], '無資料')
parsed=parse_gs1('(01)04712867148851(17)270408')
add('GS1 AI 01/17 解析', parsed, {'gtin':'4712867148851','expiry':'2027-04-08'})
ocr=parse_ocr('蔥阿伯 優選水餃 高麗菜豬肉 EXP 2027.04.08 LOT A123456')
add('OCR 日期解析', ocr.get('expiry'), '2027-04-08')
add('OCR 品名匹配', bool(find_name(ocr['productText'])), True)
add('不合格提前停止規則', evaluate(barcode='4712867148851', expiry='2027-04-08')[0]=='不合格', True)

summary={'total':len(tests),'passed':sum(t['pass'] for t in tests),'failed':sum(not t['pass'] for t in tests),'tests':tests}
(ROOT/'TEST_REPORT.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# v6 模擬測試報告','',f"- 測試數：{summary['total']}",f"- 通過：{summary['passed']}",f"- 失敗：{summary['failed']}",'','| 測試項目 | 預期 | 實際 | 結果 |','|---|---|---|---|']
for t in tests:
    lines.append(f"| {t['case']} | `{t['expected']}` | `{t['got']}` | {'PASS' if t['pass'] else 'FAIL'} |")
(ROOT/'TEST_REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
