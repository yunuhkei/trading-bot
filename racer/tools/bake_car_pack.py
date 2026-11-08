import json,base64,numpy as np
o=json.load(open('bake_nitro.json'))
S=0.0833  # garage unit -> metres (54 units long -> 4.5 m)
def conv(v,idx):
    a=np.array(v,dtype=np.float64).reshape(-1,14)
    p=a[:,0:3];n=a[:,3:6]
    # garage (x fwd, y up, z width) -> racer local (x right = z_g, y up, z = -x_g so that forward is -z); det = +1
    P=np.stack([p[:,2],p[:,1],-p[:,0]],1)*S
    N=np.stack([n[:,2],n[:,1],-n[:,0]],1)
    C=np.power(np.clip(a[:,6:9],0,1),1/2.2)
    T=np.array(idx,dtype=np.int64).reshape(-1,3)
    ar=np.linalg.norm(np.cross(P[T[:,1]]-P[T[:,0]],P[T[:,2]]-P[T[:,0]]),axis=1)
    return P,N,C,a[:,9:13],T[ar>1e-9]
meshes=[('body',conv(o['v'],o['i']),None)]+[('wheel',conv(w['v'],w['i']),w) for w in o['wh']]
allM=np.concatenate([m[1][3] for m in meshes])
rng=np.random.default_rng(7)
u=np.unique(np.round(allM*255).astype(int),axis=0)
K=min(40,len(u));cen=u[rng.choice(len(u),K,replace=False)].astype(float)
for it in range(80):
    d=((allM[:,None,:]*255-cen[None,:,:])**2).sum(2);lab=d.argmin(1)
    for k in range(K):
        if (lab==k).any(): cen[k]=allM[lab==k].mean(0)*255
d=((allM[:,None,:]*255-cen[None,:,:])**2).sum(2)
print('material classes',K,'max err (of 255)',round(float(np.sqrt(d.min(1)).max()),1))
def classify(M):
    return ((M[:,None,:]*255-cen[None,:,:])**2).sum(2).argmin(1)
blobs=[];meta={'s':S,'q':8192,'mat':[[int(round(x)) for x in c] for c in cen],'parts':[],'wheels':[]}
for name,(P,N,C,M,T),w in meshes:
    pq=np.round(P*8192).astype(np.int16);nq=np.round(np.clip(N,-1,1)*127).astype(np.int8)
    cq=np.round(np.clip(C,0,1)*255).astype(np.uint8);iq=classify(M).astype(np.uint8);tq=T.astype(np.uint16)
    blob=b''.join([pq.tobytes(),nq.tobytes(),cq.tobytes(),iq.tobytes(),tq.tobytes()])
    d=dict(nv=len(pq),nt=len(tq),off=sum(len(b) for b in blobs),len=len(blob))
    blobs.append(blob)
    if name=='body': meta['parts'].append(d)
    else:
        d['x']=round(-w['x']*S,4);d['R']=round(w['R']*S,4);d['lat']=round((w['zo']-w['w'])*S,4);meta['wheels'].append(d)
raw=b''.join(blobs)
print('raw',len(raw),'b64',len(base64.b64encode(raw)))
open('car_nitro.bin','wb').write(raw);open('car_nitro.json','w').write(json.dumps(meta))
print(json.dumps({k:v for k,v in meta.items() if k!='mat'}))
