# Optional Unix PTY regression; requires Python 3 standard library, outside npm test.
import os,pty,select,subprocess,tempfile,pathlib,socket,time,signal,shutil,json
root=str(pathlib.Path(__file__).resolve().parents[1])
directory=tempfile.mkdtemp(prefix='st-terminal-060-')
env=os.environ.copy();env.update(DATA_DIR=directory,ROOM_PASSWORD='Room-Terminal-060',DM_PASSWORD='Keeper-Terminal-060',HOST='127.0.0.1')
room='Room-Reset-060';dm='Keeper-Reset-060'
def terminal(values,expected=0,cancel=False):
 master,slave=pty.openpty();p=subprocess.Popen(['node','--import','tsx','scripts/password-reset.ts'],cwd=root,env=env,stdin=slave,stdout=slave,stderr=slave,close_fds=True);os.close(slave)
 data=b'';cursor=0
 try:
  prompts=['新房间口令：','再次输入房间口令：','新 DM 密码：','再次输入 DM 密码：']
  for index,value in enumerate(values):
   target=prompts[index].encode();deadline=time.time()+12
   while target not in data[cursor:]:
    if time.time()>deadline:raise AssertionError('terminal prompt timeout')
    if select.select([master],[],[],.1)[0]:
     try:chunk=os.read(master,65536)
     except OSError:raise AssertionError('terminal ended early')
     data+=chunk
   cursor=data.index(target,cursor)+len(target)
   os.write(master,b'\x03' if cancel else value.encode()+b'\r')
  deadline=time.time()+12
  while p.poll() is None or select.select([master],[],[],0)[0]:
   if time.time()>deadline:raise AssertionError('terminal completion timeout')
   if select.select([master],[],[],.1)[0]:
    try:chunk=os.read(master,65536)
    except OSError:break
    if not chunk:break
    data+=chunk
  assert p.wait(timeout=3)==expected
  for value in values:
   if value:assert value.encode() not in data,'password echoed in terminal'
  return data.decode(errors='replace')
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master)
server=None
try:
 out=terminal([room,room,dm,dm]);assert '密码已重置' in out
 credentials=pathlib.Path(directory,'credentials.json');before=credentials.read_bytes();assert room.encode() not in before and dm.encode() not in before
 print('PASS Linux PTY: offline initialization and four hidden password inputs')
 out=terminal(['Room-Mismatch-060','Room-Different-060'],1);assert '不一致' in out and credentials.read_bytes()==before
 print('PASS Linux PTY: mismatched confirmation leaves credentials unchanged')
 out=terminal([''],1,True);assert '已取消' in out and credentials.read_bytes()==before
 print('PASS Linux PTY: Ctrl+C cancels without changes')
 s=socket.socket();s.bind(('127.0.0.1',0));env['PORT']=str(s.getsockname()[1]);s.close()
 server=subprocess.Popen(['node','--import','tsx','src/server/index.ts'],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 ready=b'';deadline=time.time()+12
 while b'SMALLTABLE:' not in ready:
  assert time.time()<deadline,'server start timeout'
  assert server.poll() is None,'server exited'
  if select.select([server.stdout],[],[],.1)[0]:ready+=os.read(server.stdout.fileno(),4096)
 out=terminal(['Room-Blocked-060']*2+['Keeper-Blocked-060']*2,1);assert '凭证锁' in out and credentials.read_bytes()==before
 print('PASS Linux PTY: running service refuses reset and preserves credentials')
 server.send_signal(signal.SIGTERM);assert server.wait(timeout=10)==0;server=None
 run=subprocess.run(['node','--import','tsx','scripts/password-reset.ts'],cwd=root,env=env,input='',capture_output=True,text=True,timeout=10)
 assert run.returncode!=0 and '交互式终端' in run.stderr and credentials.read_bytes()==before
 print('PASS terminal: non-TTY input rejected without changes')
finally:
 if server is not None:server.kill();server.wait()
 shutil.rmtree(directory)
