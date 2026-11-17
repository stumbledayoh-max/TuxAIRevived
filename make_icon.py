import sys, os
src, outdir, appname, color = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
from PIL import Image, ImageDraw, ImageFont
sizes = {"mipmap-mdpi":48,"mipmap-hdpi":72,"mipmap-xhdpi":96,"mipmap-xxhdpi":144,"mipmap-xxxhdpi":192}
fg_sizes = {"mipmap-mdpi":108,"mipmap-hdpi":162,"mipmap-xhdpi":216,"mipmap-xxhdpi":324,"mipmap-xxxhdpi":432}
def hex2rgb(h):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def load_font(px):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, px)
    return ImageFont.load_default()
def default_icon(size):
    img = Image.new("RGBA",(size,size),(0,0,0,0))
    d = ImageDraw.Draw(img)
    c1, c2 = hex2rgb(color), (255,255,255)
    # gradiente vertical
    for y in range(size):
        t=y/max(size-1,1)
        r=int(c1[0]*(1-t)+90*t); g=int(c1[1]*(1-t)+60*t); b=int(c1[2]*(1-t)+220*t)
        d.line([(0,y),(size,y)], fill=(r,g,b,255))
    letter=(appname.strip()[:1] or "A").upper()
    f=load_font(int(size*0.52))
    box=d.textbbox((0,0),letter,font=f)
    d.text(((size-(box[2]-box[0]))/2-box[0],(size-(box[3]-box[1]))/2-box[1]),letter,font=f,fill=(255,255,255,255))
    return img
def round_icon(img):
    size=img.size[0]; mask=Image.new("L",(size,size),0); d=ImageDraw.Draw(mask)
    d.ellipse((0,0,size,size),fill=255); out=Image.new("RGBA",(size,size),(0,0,0,0)); out.paste(img,(0,0),mask); return out

base=None
if src and os.path.exists(src):
    try: base=Image.open(src).convert("RGBA")
    except Exception: base=None
for folder, size in sizes.items():
    d=os.path.join(outdir,folder); os.makedirs(d,exist_ok=True)
    if base:
        # cover: recorta quadrado central e redimensiona
        w,h=base.size; m=min(w,h); sq=base.crop(((w-m)//2,(h-m)//2,(w+m)//2,(h+m)//2)).resize((size,size), Image.LANCZOS)
    else:
        sq=default_icon(size)
    sq.save(os.path.join(d,"ic_launcher.png")); round_icon(sq).save(os.path.join(d,"ic_launcher_round.png"))
for folder, size in fg_sizes.items():
    d=os.path.join(outdir,folder); os.makedirs(d,exist_ok=True)
    if base:
        w,h=base.size; m=min(w,h); fg=base.crop(((w-m)//2,(h-m)//2,(w+m)//2,(h+m)//2)).resize((int(size*0.62),int(size*0.62)), Image.LANCZOS)
        canvas=Image.new("RGBA",(size,size),(0,0,0,0)); canvas.paste(fg,((size-fg.size[0])//2,(size-fg.size[1])//2),fg); canvas.save(os.path.join(d,"ic_launcher_foreground.png"))
    else:
        default_icon(size).save(os.path.join(d,"ic_launcher_foreground.png"))
# anydpi adaptive
d=os.path.join(outdir,"mipmap-anydpi-v26"); os.makedirs(d,exist_ok=True)
xml='<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n'
open(os.path.join(d,"ic_launcher.xml"),"w").write(xml); open(os.path.join(d,"ic_launcher_round.xml"),"w").write(xml)
print("icons ok")
