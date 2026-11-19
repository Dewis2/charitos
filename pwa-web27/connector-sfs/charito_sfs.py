"""Charito SFS connector. Python stdlib, Windows DPAPI; no SOL/certificate access.

The supported interface is the official SFS 2.5 JSON input and its XML/CDR/PDF
directories. SFS must be installed/configured separately, including its batch jobs.
No browser automation, internal SFS HTTP endpoints or direct SUNAT submission.
"""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from xml.etree import ElementTree as ET
from zipfile import ZipFile
from io import BytesIO
import argparse, base64, ctypes, hashlib, json, logging, logging.handlers, os, re, sys, time, uuid

VERSION='1.0.0'
PROJECT='https://example-project.supabase.co'
RUC='00000000000'
MAX_XML=1048576
DATA_HOME=Path(os.environ.get('LOCALAPPDATA',str(Path.home()))) / 'CharitoSFS'
log=logging.getLogger('charito-sfs')

def decimal(value):
    n=Decimal(str(value))
    if not n.is_finite():raise ValueError('Importe no finito.')
    return n

def amount(n):return format(decimal(n).quantize(Decimal('.01'),rounding=ROUND_HALF_UP),'f')
def precise(n):return format(decimal(n).quantize(Decimal('.0000000001'),rounding=ROUND_HALF_UP),'f')
def reference(s):return f"{s['series']}-{int(s['number'])}"

def validate_snapshot(s):
    if s.get('schema')!=1 or s.get('ruc')!=RUC or s.get('currency')!='PEN':raise ValueError('Emisor, moneda o versión no admitidos.')
    if s.get('type') not in ('01','03') or not re.fullmatch(('F' if s['type']=='01' else 'B')+'[A-Z0-9]{3}',s.get('series','')):raise ValueError('Serie incompatible.')
    if not 1<=int(s.get('number',0))<=99999999:raise ValueError('Número inválido.')
    if not re.fullmatch(r'\d{4}',s.get('establishment_code','')):raise ValueError('Falta el código de establecimiento confirmado.')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',s.get('emission_date','')) or not re.fullmatch(r'\d{2}:\d{2}:\d{2}',s.get('emission_time','')):raise ValueError('Fecha u hora inválida.')
    lines=s.get('lines',[])
    if not 1<=len(lines)<=100:raise ValueError('Detalle fuera del límite.')
    for field in (s['customer']['name'],s['legal_name'],*[l['description'] for l in lines]):
        if ']]>' in field or re.search(r'[\x00-\x1f]',field):raise ValueError('Texto no admitido en el XML fiscal.')
    for l in lines:
        if decimal(l['quantity'])<=0 or decimal(l['base'])<=0 or decimal(l['igv'])<0 or decimal(l['gross'])!=decimal(l['base'])+decimal(l['igv']):raise ValueError('Línea fiscal sin conciliar.')
        if l['affectation'] not in ('10','20','30') or l['unit'] not in ('NIU','KGM','LTR'):raise ValueError('Tributo o unidad sin soporte.')
        if l['affectation']!='10' and decimal(l['igv'])!=0:raise ValueError('IGV no corresponde a la afectación.')
    for key in ('total','base','igv'):
        field='gross' if key=='total' else key
        if sum((decimal(l[field]) for l in lines),Decimal(0))!=decimal(s[key]):raise ValueError('Totales sin conciliar.')

def words(n):
    small=['CERO','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE','VEINTIUNO','VEINTIDÓS','VEINTITRÉS','VEINTICUATRO','VEINTICINCO','VEINTISÉIS','VEINTISIETE','VEINTIOCHO','VEINTINUEVE']
    if n<30:return small[n]
    if n<100:return ['', '', '', 'TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'][n//10]+(' Y '+words(n%10) if n%10 else '')
    if n==100:return 'CIEN'
    if n<1000:return ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'][n//100]+(' '+words(n%100) if n%100 else '')
    if n<1000000:return ('MIL' if n//1000==1 else words(n//1000).removesuffix('UNO')+('UN' if words(n//1000).endswith('UNO') else '')+' MIL')+(' '+words(n%1000) if n%1000 else '')
    return ('UN MILLÓN' if n//1000000==1 else words(n//1000000).removesuffix('UNO')+('UN' if words(n//1000000).endswith('UNO') else '')+' MILLONES')+(' '+words(n%1000000) if n%1000000 else '')

def sfs_payload(s):
    """Exact field names from SUNAT Estructuras.xlsx (2026-06), Factura y boleta 2.1.
    SFS JSON amounts are STRINGS, as required by its published distribution parser.
    Prices are already net of the allocated sale discount; never deduct it twice.
    """
    validate_snapshot(s)
    customer=s['customer']
    header=dict(tipOperacion='0101',fecEmision=s['emission_date'],horEmision=s['emission_time'],fecVencimiento='-',
        codLocalEmisor=s['establishment_code'],tipDocUsuario=customer['type'],numDocUsuario=customer['number'],rznSocialUsuario=customer['name'],
        tipMoneda='PEN',sumTotTributos=amount(s['igv']),sumTotValVenta=amount(s['base']),sumPrecioVenta=amount(s['total']),
        sumDescTotal='0.00',sumOtrosCargos='0.00',sumTotalAnticipos='0.00',sumImpVenta=amount(s['total']),ublVersionId='2.1',customizationId='2.0')
    items=[];totals={}
    tributes={'10':('1000','IGV','VAT'),'20':('9997','EXO','VAT'),'30':('9998','INA','FRE')}
    for l in s['lines']:
        code,name,kind=tributes[l['affectation']]
        items.append(dict(codUnidadMedida=l['unit'],ctdUnidadItem=precise(l['quantity']),codProducto=l['code'],codProductoSUNAT='-',desItem=l['description'],
            mtoValorUnitario=precise(l['unit_value']),sumTotTributosItem=amount(l['igv']),codTriIGV=code,mtoIgvItem=amount(l['igv']),mtoBaseIgvItem=amount(l['base']),
            nomTributoIgvItem=name,codTipTributoIgvItem=kind,tipAfeIGV=l['affectation'],porIgvItem=amount(l['rate']),
            mtoPrecioVentaUnitario=precise(l['unit_price']),mtoValorVentaItem=amount(l['base']),mtoValorReferencialUnitario='0.00'))
        t=totals.setdefault(code,dict(ideTributo=code,nomTributo=name,codTipTributo=kind,base=Decimal(0),tax=Decimal(0)))
        t['base']+=decimal(l['base']);t['tax']+=decimal(l['igv'])
    taxes=[dict(ideTributo=t['ideTributo'],nomTributo=t['nomTributo'],codTipTributo=t['codTipTributo'],mtoBaseImponible=amount(t['base']),mtoTributo=amount(t['tax'])) for t in totals.values()]
    cents=int((decimal(s['total'])*100).to_integral_exact())
    payload=dict(cabecera=header,detalle=items,tributos=taxes,leyendas=[dict(codLeyenda='1000',desLeyenda=f"{words(cents//100)} Y {cents%100:02d}/100 SOLES")])
    if s['type']=='01':payload['datoPago']=dict(formaPago='Contado',mtoNetoPendientePago='-',tipMonedaMtoNetoPendientePago='-')
    return payload

def basename(s):return f"{s['ruc']}-{s['type']}-{reference(s)}"
def xml_root(raw,limit=MAX_XML):
    if len(raw)>limit or re.search(br'<!\s*(DOCTYPE|ENTITY)',raw,re.I):raise ValueError('XML no permitido o demasiado grande.')
    return ET.fromstring(raw)

def child(node,name):return next((c for c in node if c.tag.split('}')[-1]==name),None)
def path_text(node,*names):
    for name in names:
        node=child(node,name)
        if node is None:return ''
    return node.text or ''

def cdr_result(raw,s):
    root=xml_root(raw,128000)
    if root.tag.split('}')[-1]!='ApplicationResponse':raise ValueError('No es una constancia CDR.')
    ref=path_text(root,'DocumentResponse','DocumentReference','ID')
    match=re.fullmatch(re.escape(s['series'])+r'-(\d{1,8})',ref)
    if not match or int(match[1])!=int(s['number']) or path_text(root,'ReceiverParty','PartyIdentification','ID')!=s['ruc']:raise ValueError('CDR de otro RUC o documento.')
    code=path_text(root,'DocumentResponse','Response','ResponseCode')
    if not re.fullmatch(r'\d{1,5}',code):raise ValueError('CDR sin código de respuesta.')
    return {'code':code,'accepted':code=='0','description':path_text(root,'DocumentResponse','Response','Description')}

def read_cdr(path,s):
    if path.stat().st_size>1048576:raise ValueError('Archivo de respuesta demasiado grande.')
    if path.suffix.lower()=='.zip':
        with ZipFile(path) as archive:
            files=[f for f in archive.infolist() if f.filename.lower().endswith('.xml')]
            if len(files)!=1 or files[0].file_size>128000:raise ValueError('ZIP de CDR no válido.')
            raw=archive.read(files[0])
    else:raw=path.read_bytes()
    cdr_result(raw,s)
    return raw

def atomic_write(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    os.replace(temporary,path)

class Blob(ctypes.Structure):
    _fields_=[('cbData',ctypes.c_ulong),('pbData',ctypes.POINTER(ctypes.c_ubyte))]

def protect(raw,decrypt=False):
    if os.name!='nt':raise RuntimeError('Este conector requiere Windows y protección DPAPI.')
    buffer=ctypes.create_string_buffer(raw);source=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)));target=Blob()
    function=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):raise ctypes.WinError()
    try:return ctypes.string_at(target.pbData,target.cbData)
    finally:ctypes.windll.kernel32.LocalFree(target.pbData)

def save_private(path,data):atomic_write(path,protect(json.dumps(data,ensure_ascii=False,default=str).encode('utf-8')))
def load_private(path):return json.loads(protect(path.read_bytes(),decrypt=True),parse_float=Decimal)

class Api:
    def __init__(self,config):self.config=config
    def request(self,url,raw,headers,limit=2097152):
        try:
            with urlopen(Request(url,data=raw,headers=headers,method='POST'),timeout=35) as response:
                data=response.read(limit+1)
            if len(data)>limit:raise ValueError('La respuesta supera el límite.')
            return json.loads(data,parse_float=Decimal)
        except HTTPError as e:
            # Avoid logging URLs, JWTs, tokens, customer information, or HTTP bodies.
            if e.code in (401,403):raise RuntimeError('Acceso del conector revocado o vencido. Regenera su conexión en Charito.') from None
            raise RuntimeError(f'El servidor devolvió HTTP {e.code}. Revisa el estado del módulo y vuelve a sincronizar.') from None
        except URLError:raise RuntimeError('No hay conexión segura con Supabase.') from None
    def rpc(self,action,data=None):
        return self.request(PROJECT+'/rest/v1/rpc/charito_sfs_agent',json.dumps({'p_token':self.config['token'],'p_action':action,'p_data':data or {}},default=str).encode(),
            {'apikey':self.config['public_key'],'Content-Type':'application/json'})
    def upload(self,id,kind,raw):
        from urllib.parse import urlencode
        return self.request(PROJECT+'/functions/v1/charito-sfs?'+urlencode({'document':id,'kind':kind}),raw,
            {'apikey':self.config['public_key'],'x-charito-connector':self.config['token'],'Content-Type':'application/pdf' if kind.endswith('.pdf') else 'application/xml'})

def resolve_sfs(selected):
    root=Path(selected).expanduser().resolve()
    # Accept either SFS installation root or its sunat_archivos/sfs directory.
    if (root/'sunat_archivos/sfs/DATA').is_dir():root=root/'sunat_archivos/sfs'
    if not all((root/name).is_dir() for name in ['DATA','RPTA','FIRMA','ENVIO','PARSE','REPO']):raise ValueError('Selecciona una instalación SFS con DATA, RPTA, FIRMA, ENVIO, PARSE y REPO.')
    return root

def validate_config(c):
    if c.get('schema')!=1 or c.get('url','').rstrip('/')!=PROJECT:raise ValueError('La conexión no corresponde al proyecto Charito.')
    uuid.UUID(c.get('store_id',''))
    if not re.fullmatch(r'[a-f0-9]{64}',c.get('token','')) or not c.get('public_key','').startswith('sb_publishable_'):raise ValueError('Archivo de conexión inválido.')

class Connector:
    def __init__(self,config,api=None,home=DATA_HOME):
        validate_config(config);self.config=config;self.root=resolve_sfs(config['sfs_path']);self.home=Path(home)/config['store_id'];self.home.mkdir(parents=True,exist_ok=True)
        self.api=api or Api(config);self.records={};self.paused=False
    def record_path(self,id):uuid.UUID(id);return self.home/'journal'/f'{id}.dpapi'
    def save(self,r):save_private(self.record_path(r['id']),r);self.records[r['id']]=r
    def read(self,id):
        if id not in self.records and self.record_path(id).exists():self.records[id]=load_private(self.record_path(id))
        return self.records.get(id)
    def evidence(self,s):
        stem=basename(s)
        return any((self.root/folder/(prefix+stem+extension)).exists() for folder in ['DATA','ORIDAT','PARSE','FIRMA','ENVIO','RPTA','REPO'] for prefix in ('','R-') for extension in ('.json','.JSON','.xml','.XML','.zip','.ZIP','.pdf','.PDF'))
    def expose(self,r):
        s=r['snapshot'];target=self.root/'DATA'/(basename(s)+'.json');raw=json.dumps(sfs_payload(s),ensure_ascii=False,indent=2).encode('utf-8')
        if r['phase']=='exposed':return
        # If SFS already consumed the atomic JSON, its archive/output is evidence.
        if self.evidence(s):
            if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=hashlib.sha256(raw).hexdigest():raise ValueError('Ya existe un archivo fiscal distinto con el mismo número. Se detuvo la entrega.')
        else:atomic_write(target,raw)
        r['phase']='exposed';self.save(r);log.info('Documento %s entregado a SFS.',reference(s))
    def collect(self,r):
        s=r['snapshot'];stem=basename(s);files={}
        for folder,kind,prefixes,extensions in [('RPTA','cdr.xml',('R-',''),('.zip','.xml')),('FIRMA','signed.xml',('',),('.xml',)),('ENVIO','signed.xml',('',),('.zip',)),('REPO','representation.pdf',('',),('.pdf',))]:
            if kind in r.get('uploaded',[]):continue
            path=next((self.root/folder/(pre+stem+ext) for pre in prefixes for ext in (*extensions,*(e.upper() for e in extensions)) if (self.root/folder/(pre+stem+ext)).is_file()),None)
            if not path:continue
            if path.stat().st_size>5242880:raise ValueError('El archivo fiscal supera 5 MB.')
            if kind=='cdr.xml':
                raw=read_cdr(path,s);result=cdr_result(raw,s)
                # Server validates the XML reference/RUC/code as well.
                self.api.rpc('result',{'id':r['id'],'cdr_xml':raw.decode('utf-8-sig')})
                r['result']=result;self.save(r)
            elif kind=='signed.xml':
                if path.suffix.lower()=='.zip':
                    with ZipFile(path) as z:
                        entries=[f for f in z.infolist() if f.filename.lower().endswith('.xml')]
                        if len(entries)!=1 or entries[0].file_size>MAX_XML:raise ValueError('ZIP XML inválido.')
                        raw=z.read(entries[0])
                else:raw=path.read_bytes()
                root=xml_root(raw)
                if path_text(root,'ID')!=reference(s):raise ValueError('XML firmado de otro comprobante.')
                # FIRMA may still contain the unsigned staging XML. In that case
                # continue to ENVIO, where SFS writes its final signed ZIP.
                if not any(e.tag.endswith('}SignatureValue') and e.text for e in root.iter()):continue
            else:
                raw=path.read_bytes()
                if not raw.startswith(b'%PDF-'):raise ValueError('PDF de SFS inválido.')
            self.api.upload(r['id'],kind,raw)
            r.setdefault('uploaded',[]).append(kind);self.save(r)
        if 'result' not in r and time.time()-float(r.get('exported_timestamp',time.time()))>300 and not r.get('warned'):
            self.api.rpc('review',{'id':r['id'],'message':'SFS aún no devolvió una constancia. Revisa la bandeja y conexión de esta PC; no vuelvas a emitir la venta.'})
            r['warned']=True;self.save(r)
    def once(self):
        response=self.api.rpc('poll',{'version':VERSION})
        if response.get('store_id')!=self.config['store_id'] or response.get('ruc')!=RUC:raise ValueError('La conexión está asignada a otra tienda o RUC.')
        for job in response.get('pending',[]):
            r=self.read(job['id'])
            if not r:
                self.api.rpc('review',{'id':job['id'],'message':'La PC no tiene el diario de este comprobante. Recupera la copia del conector y concilia SFS antes de continuar.'})
                log.warning('Documento %s requiere recuperar el diario local.',reference(job['snapshot']));continue
            if r['phase']=='prepared':r['phase']='authorized';r['exported_timestamp']=time.time();self.save(r)
            self.expose(r)
        job=response.get('job')
        if job:
            s=job['snapshot']
            try:validate_snapshot(s);sfs_payload(s)
            except (ValueError,KeyError,ArithmeticError) as e:
                self.api.rpc('preparation_error',{'id':job['id'],'lease':job['lease'],'message':'No se exportó: '+str(e)})
                raise ValueError('El comprobante requiere revisión antes de exportar.') from None
            existing=self.read(job['id'])
            if existing and existing['phase']=='exposed':raise ValueError('El servidor y el diario local no coinciden. Se requiere conciliación.')
            r={'id':job['id'],'snapshot':s,'lease':job['lease'],'phase':'prepared','uploaded':[]}
            # Prepare and persist BEFORE requesting authorization. No file is exposed yet.
            sfs_payload(s);self.save(r)
            self.api.rpc('export',{'id':r['id'],'lease':r['lease']})
            r['phase']='authorized';r['exported_timestamp']=time.time();self.save(r);self.expose(r)
        # Keep retrying artifact uploads even after the CDR changed the server status.
        for p in (self.home/'journal').glob('*.dpapi'):
            r=self.read(p.stem)
            if r and r['phase']=='exposed' and len(r.get('uploaded',[]))<3:
                try:self.collect(r)
                except (OSError,RuntimeError,ValueError,ET.ParseError) as e:log.warning('Archivo pendiente de %s: %s',reference(r['snapshot']),str(e))
        return response

def configure_gui():
    import tkinter as tk
    from tkinter import ttk,filedialog,messagebox
    w=tk.Tk();w.title('Charito · Conector SFS');w.geometry('620x390');w.resizable(False,False)
    frame=ttk.Frame(w,padding=24);frame.pack(fill='both',expand=True)
    ttk.Label(frame,text='Conectar la PC de esta tienda',font=('Segoe UI',17,'bold')).pack(anchor='w',pady=(0,18))
    connection=tk.StringVar();installation=tk.StringVar()
    for title,var,select in [('Archivo de conexión descargado de Charito',connection,lambda:filedialog.askopenfilename(filetypes=[('Conexión Charito','*.json')])),('Carpeta donde instalaste SFS',installation,lambda:filedialog.askdirectory())]:
        ttk.Label(frame,text=title).pack(anchor='w');row=ttk.Frame(frame);row.pack(fill='x',pady=(5,14));ttk.Entry(row,textvariable=var).pack(side='left',fill='x',expand=True);ttk.Button(row,text='Seleccionar',command=lambda v=var,f=select:v.set(f() or v.get())).pack(side='right',padx=(8,0))
    ttk.Label(frame,text='Requiere SFS configurado, certificado y procesos batch activos.\nEl conector no solicita tu clave SOL.',wraplength=550).pack(anchor='w',pady=(0,16))
    def save():
        try:
            p=Path(connection.get());c=json.loads(p.read_text(encoding='utf-8-sig'));validate_config(c);c['sfs_path']=str(resolve_sfs(installation.get()));
            response=Api(c).rpc('heartbeat',{'version':VERSION})
            if response.get('store_id')!=c['store_id']:raise ValueError('Tienda incorrecta.')
            save_private(DATA_HOME/'connection.dpapi',c)
            messagebox.showinfo('Conexión guardada',f"PC configurada para {c.get('store_name','esta tienda')}.\nLa conexión está protegida con tu cuenta de Windows.\nElimina el JSON descargado después de guardar una copia protegida.");w.destroy()
        except Exception as e:messagebox.showerror('No se pudo configurar',str(e))
    ttk.Button(frame,text='Guardar y comprobar conexión',command=save).pack(anchor='e');w.mainloop()

def main():
    parser=argparse.ArgumentParser(description='Charito · Conector de archivos SFS 2.5')
    parser.add_argument('command',nargs='?',choices=['configure','run','once','diagnose'],default='configure');args=parser.parse_args()
    DATA_HOME.mkdir(parents=True,exist_ok=True)
    handler=logging.handlers.RotatingFileHandler(DATA_HOME/'connector.log',maxBytes=1048576,backupCount=3,encoding='utf-8');handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'));log.addHandler(handler);log.setLevel(logging.INFO)
    try:
        if args.command=='configure':configure_gui();return
        c=load_private(DATA_HOME/'connection.dpapi');connector=Connector(c)
        if args.command=='diagnose':
            # Poll reserves jobs, so diagnostics use no remote operation.
            print(f"Charito SFS {VERSION}\nTienda: {c.get('store_name','')}\nCarpeta SFS: verificada\nConexión: protegida con DPAPI\nRegistro: {DATA_HOME/'connector.log'}");return
        import msvcrt
        lock=open(connector.home/'running.lock','a+b');lock.seek(0);lock.write(b'1');lock.flush();lock.seek(0)
        try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:raise RuntimeError('El conector ya está ejecutándose para esta tienda.') from None
        log.info('Conector %s iniciado.',VERSION)
        if args.command=='once':connector.once();return
        failures=0
        while True:
            try:connector.once();failures=0
            except (ValueError,RuntimeError,OSError,ET.ParseError) as e:
                failures+=1;log.error('%s',str(e))
            time.sleep(min(60,5*2**min(failures,3)))
    except KeyboardInterrupt:log.info('Conector detenido.')
    except Exception as e:
        log.error('Inicio: %s',str(e))
        if args.command=='configure':
            ctypes.windll.user32.MessageBoxW(None,'No se pudo abrir el conector. Revisa el registro en '+str(DATA_HOME),'Charito SFS',16)
        else:print('No se pudo iniciar el conector. '+str(e),file=sys.stderr)
        sys.exit(1)

if __name__=='__main__':main()
