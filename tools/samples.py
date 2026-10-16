# Rebuilds public/samples from the source sample libraries (see README: sparse clones of gleitz/midi-js-soundfonts and sfzinstruments/virtuosity_drums).
import subprocess, re, os, json
SF=os.environ.get('SF','/home/claude/samples/sf'); VD=os.environ.get('VD','/home/claude/samples/vd/Samples/oh')
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','public','samples')
NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
def nm(m): return f"{NAMES[m%12]}{m//12-1}"
def maxvol(f, af=''):
    cmd=['ffmpeg','-v','info','-i',f]+(['-af',af+',volumedetect'] if af else ['-af','volumedetect'])+['-f','null','-']
    o=subprocess.run(cmd,capture_output=True,text=True).stderr
    return float(re.search(r'max_volume: (-?[\d.]+)',o).group(1))
def enc(src,dst,dur,gain,fade=.35,th=-50):
    af=f"silenceremove=start_periods=1:start_threshold={th}dB,atrim=0:{dur},afade=t=out:st={dur-fade}:d={fade},volume={gain}dB"
    subprocess.run(['ffmpeg','-v','error','-y','-i',src,'-ac','1','-af',af,'-b:a','112k',dst],check=True)
manifest={}
inst={'bass':('MusyngKite/acoustic_bass-mp3',range(28,53,2),2.6),
      'piano':('MusyngKite/acoustic_grand_piano-mp3',range(46,83,2),3.1),
      'rhodes':('MusyngKite/electric_piano_1-mp3',range(46,83,2),3.1),
      'guitar':('MusyngKite/electric_guitar_jazz-mp3',range(46,79,2),2.6)}
for k,(d,rng,dur) in inst.items():
    os.makedirs(f'{OUT}/{k}',exist_ok=True); manifest[k]=[]
    for m in rng:
        src=f'{SF}/{d}/{nm(m)}.mp3'
        g=-2-maxvol(src)
        enc(src,f'{OUT}/{k}/{m}.mp3',min(dur,3.1),g); manifest[k].append(m)
drums={'ride':[f'ride/oh_ride_ride_vl{v}_rr{r}.flac' for v in (1,2,3) for r in (1,2)],
 'bell':['ride/oh_ride_bell_vl2_rr1.flac'],
 'hhpedal':[f'hh/oh_hh_pedal_vl{v}_rr{r}.flac' for v in (2,3) for r in (1,2)],
 'hhclosed':[f'hh/oh_hh_closed_vl{v}_rr{r}.flac' for v in (2,3) for r in (1,2)],
 'hhhalf':['hh/oh_hh_half_vl2_rr1.flac'],
 'kick':[f'kick/oh_kick_snon_vl{v}_rr1.flac' for v in (1,2,3)],
 'snare':[f'snare/oh_snare_center_vl{v}.flac' for v in (8,16,24,32)],
 'xstick':[f'snare/oh_snare_crossstick_vl{v}.flac' for v in (6,12)]}
os.makedirs(f'{OUT}/drums',exist_ok=True); manifest['drums']={}
for k,files in drums.items():
    mx=max(maxvol(f'{VD}/{f}','aformat=channel_layouts=mono') for f in files)
    g=-3-mx; manifest['drums'][k]=[]
    for i,f in enumerate(files):
        dur=3.0 if k in('ride','bell') else (1.5 if k=='hhhalf' else 1.0)
        enc(f'{VD}/{f}',f'{OUT}/drums/{k}{i}.mp3',dur,g,fade=.3 if dur>1 else .2,th=-75); manifest['drums'][k].append(f'{k}{i}')
json.dump(manifest,open(f'{OUT}/manifest.json','w'))
print(json.dumps(manifest)[:600])
