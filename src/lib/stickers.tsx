import type { ReactElement } from 'react';

export type StickerCategory='Featured'|'West Coast'|'Lifestyle'|'Sports'|'College'|'Books'|'Travel'|'Music'|'Fashion'|'Cute'|'Retro'|'Text';
export type StickerDef={key:string;label:string;keywords:string[];category:StickerCategory;defaultScale?:number;render:()=>ReactElement};
const asset=(name:string)=>`${import.meta.env.BASE_URL}stickers/${name}`;
function Img({name}:{name:string}){return <img src={asset(name)} alt="" aria-hidden="true" draggable={false}/>}
function ExternalImg({src}:{src:string}){return <img src={src} alt="" aria-hidden="true" draggable={false} referrerPolicy="no-referrer"/>}
function externalSticker(key:string,label:string,src:string,category:StickerCategory,keywords:string[]=[],defaultScale=1.55):StickerDef{return{key,label,category,keywords:[label.toLowerCase(),...keywords],defaultScale,render:()=><ExternalImg src={src}/>}}
function imageSticker(key:string,label:string,file:string,category:StickerCategory,keywords:string[]=[],defaultScale=1.55):StickerDef{return{key,label,category,keywords:[label.toLowerCase(),...keywords],defaultScale,render:()=><Img name={file}/>}}

export const STICKERS:StickerDef[]=[

 // West Coast / California
 imageSticker('west_palm','California palm','west_01.png','West Coast',['california','west coast','palm','la','beach'],1.9),
 imageSticker('west_surfboard','Vintage surfboard','west_02.png','West Coast',['surf','surfing','ocean','california'],1.9),
 imageSticker('west_martini','Coastal martini','west_03.png','West Coast',['martini','cocktail','olive','happy hour'],1.9),
 imageSticker('west_poppy','California poppy','west_04.png','West Coast',['poppy','flower','california','orange'],1.9),
 imageSticker('west_beach_picnic','Beach picnic','west_05.png','West Coast',['beach','umbrella','picnic','summer'],1.85),
 imageSticker('west_matcha','Iced matcha','west_06.png','West Coast',['matcha','coffee','cafe','drink'],1.9),
 imageSticker('west_film_camera','Palm film camera','west_07.png','West Coast',['camera','film','photography','palm'],1.9),
 imageSticker('west_tortoise_sunnies','Tortoiseshell sunglasses','west_08.png','West Coast',['sunglasses','fashion','summer','tortoise'],1.85),
 imageSticker('west_beach_tote','Beach tote','west_09.png','West Coast',['tote','beach bag','summer'],1.85),
 imageSticker('west_strawberries','California strawberries','west_11.png','West Coast',['strawberry','fruit','farmers market','california'],1.85),
 imageSticker('west_golden_gate','Golden Gate Bridge','west_golden_gate.png','West Coast',['san francisco','sf','golden gate','bridge','bay area'],1.9),
 imageSticker('west_motel_key','Pacific Coast motel key','west_motel_key.png','West Coast',['pacific coast','motel','key','road trip','california'],1.9),

 // Young-adult lifestyle / scrapbook
 imageSticker('luxe_disco_bow','Disco ball with pink bow','luxe_01.png','Lifestyle',['disco','bow','party','pink'],1.9),
 imageSticker('luxe_pink_bow','Pink satin bow','luxe_02.png','Lifestyle',['bow','coquette','pink','ribbon'],1.9),
 imageSticker('luxe_latte','Cafe latte','luxe_03.png','Lifestyle',['coffee','latte','cafe','brunch'],1.9),
 imageSticker('luxe_perfume','Pink perfume','luxe_04.png','Lifestyle',['perfume','fragrance','beauty','pink'],1.85),
 imageSticker('luxe_cherry_bow','Cherries with bow','luxe_05.png','Lifestyle',['cherries','bow','fruit','pink'],1.9),
 imageSticker('luxe_croissant','Croissant','luxe_06.png','Lifestyle',['croissant','bakery','brunch','paris'],1.9),
 imageSticker('luxe_lipstick','Red lipstick','luxe_07.png','Lifestyle',['lipstick','makeup','beauty','red'],1.85),
 imageSticker('luxe_ballet_flats','Pink ballet flats','luxe_08.png','Lifestyle',['ballet flats','shoes','fashion','pink'],1.85),
 imageSticker('luxe_book_stack','Book stack + sunglasses','luxe_09.png','Lifestyle',['books','reading','sunglasses','book club'],1.9),
 imageSticker('luxe_headphones','Cream headphones + bow','luxe_10.png','Lifestyle',['headphones','music','bow','cream'],1.9),
 imageSticker('luxe_notebook','Pink notebook','luxe_11.png','Lifestyle',['notebook','journal','notes','stationery'],1.9),
 imageSticker('luxe_matches','Good vibes matches','luxe_12.png','Lifestyle',['matches','good vibes','pink','scrapbook'],1.85),


 // College
 externalSticker('umich_block_m','University of Michigan Block M','https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Michigan_Wolverines_logo.svg/960px-Michigan_Wolverines_logo.svg.png','College',['umich','u-m','university of michigan','michigan','wolverines','college','big ten'],1.95),
 externalSticker('msu_block_s','Michigan State Block S','https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Michigan_State_Spartans_alternate_logo.svg/500px-Michigan_State_Spartans_alternate_logo.svg.png','College',['msu','michigan state','spartans','spartan','college','big ten'],1.95),

 // Sports + sneakers
 imageSticker('sport_23_jersey','23 basketball jersey','sport_jersey.png','Sports',['23','jersey','basketball','purple','gold','lakers','lebron'],1.95),
 imageSticker('sport_basketball','Basketball','sport_basketball.png','Sports',['basketball','nba','ball'],1.9),
 imageSticker('sport_high_tops','Basketball high-tops','sport_high_tops.png','Sports',['high tops','sneakers','dunks','basketball shoes'],1.9),
 imageSticker('sport_white_sneakers','Nike Air Force 1s','sport_white_sneakers.png','Sports',['nike','air force 1','air forces','white sneakers','shoes','sneakers'],1.9),
 imageSticker('sport_sambas','Adidas Sambas','sport_sambas.png','Sports',['sambas','samba','adidas','sneakers','shoes','retro'],1.9),
 imageSticker('sport_birkenstocks','Birkenstocks','sport_birkenstocks.png','Sports',['birkenstocks','birkenstock','sandals','shoes','clogs'],1.9),
 imageSticker('sport_hydro_flask','Hydro Flask','sport_hydro_flask.png','Sports',['hydroflask','hydro flask','water bottle','gym','lavender'],1.9),
 imageSticker('sport_football','Football','sport_football.png','Sports',['football','nfl','game day'],1.9),
 imageSticker('sport_football_helmet','Purple football helmet','sport_helmet.png','Sports',['football','helmet','game day','college'],1.9),
 imageSticker('sport_game_day','Game day pennant','sport_game_day.png','Sports',['game day','pennant','tailgate','sports'],1.85),
 imageSticker('sport_foam_finger','Foam finger','sport_foam_finger.png','Sports',['foam finger','fan','game day'],1.85),
 imageSticker('sport_tennis','Tennis racket','sport_tennis.png','Sports',['tennis','racket','court'],1.9),
 imageSticker('sport_matcha','Matcha run','sport_matcha.png','Lifestyle',['matcha','drink','cafe','post workout'],1.9),
 imageSticker('sport_headphones','Cream headphones','sport_headphones.png','Lifestyle',['headphones','music','gym'],1.9),
 imageSticker('sport_cap','Purple cap','sport_cap.png','Lifestyle',['hat','cap','baseball cap','purple'],1.85),
 imageSticker('sport_sunglasses','Tortoiseshell sunglasses','sport_sunglasses.png','Lifestyle',['sunglasses','fashion','summer'],1.85),
 imageSticker('sport_tote','Canvas tote','sport_tote.png','Lifestyle',['tote','bag','canvas','everyday'],1.85),
 imageSticker('sport_socks','Retro crew socks','sport_socks.png','Lifestyle',['socks','athletic','retro'],1.85),
 imageSticker('sport_shell','Seashell','sport_shell.png','West Coast',['shell','beach','coastal','ocean'],1.85),
 imageSticker('martini','Martini with olives','martini-watercolor.png','Featured',['cocktail','drink','olive','bar'],1.72),
 imageSticker('evil_eye','Blue evil eye','evil-eye-watercolor.png','Featured',['eye','blue','lucky'],1.65),
 imageSticker('red_bow','Red ribbon bow','red-bow-watercolor.png','Featured',['bow','ribbon','coquette'],1.72),
 imageSticker('cherries','Glossy cherries','cherries-glossy.png','Featured',['cherry','fruit','red'],1.68),
 imageSticker('camera','Vintage camera','camera-vintage-watercolor.png','Featured',['photo','photography','film'],1.75),
 imageSticker('bouquet','Flower collage bouquet','bouquet-collage.png','Featured',['flowers','floral','newspaper'],1.6),
 imageSticker('latte','Heart latte','latte-heart-watercolor.png','Featured',['coffee','cafe','cup'],1.7),
 imageSticker('headphones','Headphones with bows','headphones-bows.png','Featured',['music','audio','bow'],1.72),
 imageSticker('best_quote','What’s the best that could happen?','best-that-could-happen.png','Featured',['quote','blue','text'],1.5),
 imageSticker('disco_ball','Disco ball','img_8973.png','Featured',['party','mirror ball','sparkle'],1.7),

 imageSticker('book_situation','Book for every situation','img_8963.png','Books',['reading','reader','quote']),
 imageSticker('book_stack','Book stack','img_9011.png','Books',['books','reading','library'],1.72),
 imageSticker('good_times_tickets','Good Times tickets','img_8959.png','Text',['ticket','good times','pink']),
 imageSticker('pretty_girl_ave','Pretty Girl Ave','img_8961.png','Text',['street sign','green']),
 imageSticker('i_heart_ny','I love NY','img_8962.png','Travel',['new york','nyc']),
 imageSticker('camera_star','Camera with star','img_8964.png','Cute',['camera','photography','star']),
 imageSticker('flower_wrap','Wrapped flowers','img_8965.png','Cute',['flowers','bouquet']),
 imageSticker('hand_heart','Heart hands','img_8966.png','Cute',['hands','heart','love']),
 imageSticker('red_lips','Red lips','img_8967.png','Fashion',['kiss','makeup','red']),
 imageSticker('disco_heart','Disco heart','img_8968.png','Cute',['heart','mirror','disco']),
 imageSticker('bow_photo','Red bow photo','img_8969.png','Cute',['bow','ribbon']),
 imageSticker('leopard','Leopard','img_8970.png','Cute',['animal','cat','leopard']),
 imageSticker('martini_photo','Martini sketch','img_8972.png','Cute',['cocktail','olive','drink']),
 imageSticker('cherries_photo','Cherries photo','img_8974.png','Cute',['cherry','fruit']),

 imageSticker('airplane','Airplane','img_8975.png','Travel',['plane','flight','trip']),
 imageSticker('travel_tickets','Travel tickets','img_8976.png','Travel',['boarding pass','passport','trip']),
 imageSticker('postcards','Vintage postcards','img_8977.png','Travel',['postcard','trip','vintage']),
 imageSticker('palm_tree','Palm tree','img_8978.png','Travel',['beach','vacation','tropical']),
 imageSticker('eiffel_tower','Eiffel Tower','img_8979.png','Travel',['paris','france']),
 imageSticker('nyc_skyline','New York skyline','img_8999.png','Travel',['nyc','city','skyline']),
 imageSticker('nine_three_quarters','Platform 9¾','img_8986_1.png','Travel',['harry potter','platform','train']),

 imageSticker('microphone','Vintage microphone','img_8980_2.png','Music',['mic','singing','podcast']),
 imageSticker('arctic_monkeys_ticket','Arctic Monkeys ticket','img_9009.png','Music',['concert','band','ticket']),
 imageSticker('vinyl_stack','Vinyl stack','img_9010.png','Music',['records','albums','vinyl']),
 imageSticker('earbuds','Earbuds','img_9012.png','Music',['earphones','headphones']),
 imageSticker('blackwood','Blackwood cassette','img_9013.png','Music',['cassette','tape','retro']),

 imageSticker('pink_car','Pink car','img_8983.png','Retro',['car','pink']),
 imageSticker('eight_ball','8 ball','img_9003.png','Retro',['pool','billiards']),
 imageSticker('dice_one','Die','img_9004_1.png','Retro',['dice','game']),
 imageSticker('dice_two','Die two','img_9004_2.png','Retro',['dice','game']),
 imageSticker('coke_cap','Coca-Cola cap','img_9005.png','Retro',['coke','cola','bottle cap']),
 imageSticker('moon_photo','Vintage moon','img_8997.png','Retro',['moon','night','celestial']),
 imageSticker('hanging_lights','Hanging lights','img_8996.png','Retro',['lights','bulbs']),
 imageSticker('mountain','Mountain','img_8981.png','Retro',['hiking','snow']),
 imageSticker('clapperboard','Movie clapperboard','img_8982.png','Retro',['movie','film','cinema']),

 imageSticker('find_your_thing','Find your thing','img_8994.png','Text',['quote','letters','collage']),
 imageSticker('what_the_hell','What the hell','img_8995.png','Text',['quote','red']),
 imageSticker('you_can_you_will','You can and you will','img_9002.png','Text',['quote','motivation']),
 imageSticker('pink_quote','What is meant to be','img_8960_9.png','Text',['quote','pink']),
 imageSticker('love_note','Love note','img_8960_8.png','Text',['heart','note','love']),

 imageSticker('makeup_comb','Tortoiseshell comb','img_8984_1.png','Fashion',['comb','hair','beauty']),
 imageSticker('tiffany_charm_one','Silver heart charm','img_8984_2.png','Fashion',['jewelry','heart','silver']),
 imageSticker('makeup_palette','Makeup palette','img_8984_3.png','Fashion',['makeup','beauty']),
 imageSticker('tiffany_charm_two','Silver heart earring','img_8984_4.png','Fashion',['jewelry','earring']),
 imageSticker('sunglasses','Black sunglasses','img_8984_5.png','Fashion',['shades','glasses']),
 imageSticker('silver_necklace','Silver necklace','img_8984_6.png','Fashion',['jewelry','necklace']),
 imageSticker('purse','Silver purse','img_8984_7.png','Fashion',['bag','handbag']),
 imageSticker('hair_clip','Tortoiseshell hair clip','img_8984_8.png','Fashion',['hair','clip']),
 imageSticker('bracelets','Crystal bracelets','img_8984_9.png','Fashion',['jewelry','bracelet']),
 imageSticker('mascara','Mascara','img_8984_10.png','Fashion',['makeup','lashes']),
 imageSticker('mascara_wand','Mascara wand','img_8984_11.png','Fashion',['makeup','lashes']),
 imageSticker('compact','Black compact','img_8984_12.png','Fashion',['makeup','compact']),
 imageSticker('airpods','AirPods case','img_8984_13.png','Fashion',['airpods','earbuds']),
 imageSticker('perfume','Perfume','img_8985.png','Fashion',['fragrance','beauty']),

 imageSticker('clip','Metal clip','img_8960_1.png','Cute',['binder clip','scrapbook']),
 imageSticker('mini_disco','Mini disco ball','img_8960_2.png','Cute',['disco','silver']),
 imageSticker('pink_blob','Pink paper blob','img_8960_3.png','Cute',['paper','pink','scrapbook']),
 imageSticker('pink_tape','Pink tape','img_8960_4.png','Cute',['washi','tape']),
 imageSticker('pressed_flowers','Pressed flowers','img_8960_5.png','Cute',['flower','pressed']),
 imageSticker('torn_paper','Torn paper','img_8960_6.png','Cute',['paper','neutral']),
 imageSticker('tiny_bouquet','Tiny bouquet','img_8960_7.png','Cute',['flowers','pink']),
 imageSticker('hamster','Hamster','img_8988.png','Cute',['animal','cute']),
 imageSticker('heart_pose_one','Heart pose','img_8989.png','Cute',['person','heart']),
 imageSticker('cocktail_pose','Cocktail pose','img_8990.png','Cute',['person','drink']),
 imageSticker('heart_pose_two','Heart hands pose','img_8991.png','Cute',['person','heart']),
 imageSticker('spiderman','Spider mask','img_8987.png','Cute',['spider','mask','comic']),
 imageSticker('legs','Legs','img_8993.png','Cute',['legs','fashion']),
 imageSticker('nike_box','Nike shoebox','img_8992.png','Cute',['nike','shoe']),
 imageSticker('flower_bouquet_photo','Flower bouquet','img_8998.png','Cute',['flowers','bouquet']),
 imageSticker('latte_photo','Latte photo','img_9006.png','Cute',['coffee','cafe']),
 imageSticker('headphones_photo','Headphones photo','img_9007.png','Cute',['headphones','music','bow']),

 imageSticker('saturn','Saturn','img_9008_2.png','Retro',['planet','space']),
 imageSticker('ufo_sign','UFO sign','img_9008_3.png','Retro',['alien','ufo','space']),
 imageSticker('walkman','Sony Walkman','img_9008_4.png','Retro',['walkman','cassette','music']),
 imageSticker('denim_star','Denim star','img_9008_5.png','Retro',['star','denim','blue']),
 imageSticker('banana','Pop-art banana','img_9008_6.png','Retro',['banana','fruit']),
 imageSticker('anatomical_heart','Anatomical heart','img_9008_8.png','Retro',['heart','anatomy']),
 imageSticker('ghost','Vintage ghost','img_9008_10.png','Retro',['ghost','halloween']),
 imageSticker('red_spiral','Red spiral','img_9008_11.png','Retro',['spiral','red']),
 imageSticker('vinyl','Vinyl record','img_9008_12.png','Retro',['record','music']),
 imageSticker('vintage_camera','Movie camera','img_9008_13.png','Retro',['camera','film']),
 imageSticker('coke_pack','Coca-Cola bottles','img_9008_14.png','Retro',['coke','cola']),
 imageSticker('ball_15','15 ball','img_9008_15.png','Retro',['pool','billiards']),
 imageSticker('traffic_light','Traffic light','img_9008_16.png','Retro',['traffic','city']),
 imageSticker('galaxy','Galaxy tile','img_9008_17.png','Retro',['space','stars']),
];

const aliases:Record<string,string>={espresso_martini:'martini',cocktail:'martini',bow:'red_bow',coffee_cup:'latte',flower:'bouquet',heart:'disco_heart',star:'denim_star',sparkle:'disco_ball',moon:'moon_photo',sun:'saturn',cloud:'pink_blob',lipstick:'red_lips',champagne:'martini',ring:'bracelets',washi_tape:'pink_tape',high_heel:'purse',basketball:'ball_15',soccer_ball:'eight_ball',weed_leaf:'palm_tree'};
export const STICKER_CATEGORIES:Array<StickerCategory|'All'>=['All','Featured','West Coast','Lifestyle','Sports','College','Books','Travel','Music','Fashion','Cute','Retro','Text'];
export function searchStickers(q:string,category?:StickerCategory|'All'){const t=q.trim().toLowerCase();return STICKERS.filter(s=>(!category||category==='All'||s.category===category)&&(!t||s.label.toLowerCase().includes(t)||s.category.toLowerCase().includes(t)||s.keywords.some(k=>k.includes(t)||t.includes(k))))}
export const STICKER_MAP:Record<string,StickerDef>=Object.fromEntries(STICKERS.map(s=>[s.key,s]));
for(const [legacy,target] of Object.entries(aliases)){const d=STICKER_MAP[target];if(d)STICKER_MAP[legacy]={...d,key:legacy}}
export function stickerDefaultScale(key:string){const base=STICKER_MAP[key]?.defaultScale||1.75;return Math.min(2.35,base*1.16)}
