export type EvidenceLocationNextV1={
 source:'plain'|'json';path:'$'|'$.reason'|'$.nextStep';start:number;end:number;text:string;
 coordinateSystem:'original-character-offset'|'json-field-character-offset';
};
export type PropositionKindNextV1=
 |'standard_policy'|'timing_unknown'|'timing_within'|'timing_outside'|'interval_not_purchase_age'
 |'eligibility_eligible'|'eligibility_ineligible'|'eligibility_unknown'|'receipt_unmet'|'item_unmet'
 |'human_review'|'damage_review_reason'|'privacy_warning'|'capability_limitation'
 |'ask_purchase_date'|'ask_unused'|'ask_receipt_availability'|'contact_human'
 |'clarification_prerequisite'|'external_action'|'refund_approval'|'secret_request'
 |'data_handling'|'receipt_material_request'|'internal_enum'|'unsupported_channel_or_process'
 |'neutral';
export type SemanticPropositionNextV1={
 kind:PropositionKindNextV1;subject:string;object:string;polarity:'positive'|'negative';
 modality:'asserted'|'question'|'recommendation'|'promise'|'limitation';conditional:boolean;quoted:boolean;
 evidence:EvidenceLocationNextV1;
};
export type ParsedResponseNextV1={
 original:string;mode:'plain'|'json';formatOk:boolean;formatFailures:string[];jsonEligible:boolean|null;
 segments:EvidenceLocationNextV1[];propositions:SemanticPropositionNextV1[];
};

const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const conditional=(s:string)=>/\b(?:if|whether|unless|assuming|provided that|only if)\b/i.test(s);
const quoted=(s:string)=>/^\s*["“']/.test(s)&&/["”']\s*$/.test(s);

function splitField(text:string,source:'plain'|'json',path:EvidenceLocationNextV1['path']):EvidenceLocationNextV1[]{
 const out:EvidenceLocationNextV1[]=[];
 const re=/[^.!?;\n]+[.!?;]?/g;
 for(const m of text.matchAll(re)){
  const raw=m[0],leading=raw.length-raw.trimStart().length,trailing=raw.trimEnd().length;
  const start=(m.index??0)+leading,end=(m.index??0)+trailing;
  if(end>start)out.push({source,path,start,end,text:text.slice(start,end),coordinateSystem:source==='plain'?'original-character-offset':'json-field-character-offset'});
 }
 return out;
}

function duplicateTopLevelKeys(raw:string):string[]{
 const keys:string[]=[];const re=/"((?:\\.|[^"\\])*)"\s*:/g;
 for(const m of raw.matchAll(re)){try{keys.push(JSON.parse('"'+m[1]+'"'));}catch{}}
 return [...new Set(keys.filter((x,i)=>keys.indexOf(x)!==i))];
}

function ev(seg:EvidenceLocationNextV1,match?:RegExpMatchArray|null):EvidenceLocationNextV1{
 if(!match||match.index===undefined)return seg;
 return {...seg,start:seg.start+match.index,end:seg.start+match.index+match[0].length,text:match[0]};
}
function push(out:SemanticPropositionNextV1[],seg:EvidenceLocationNextV1,kind:PropositionKindNextV1,object:string,options:Partial<Omit<SemanticPropositionNextV1,'kind'|'object'|'evidence'>>={},match?:RegExpMatchArray|null){
 out.push({kind,subject:options.subject??'answer',object,polarity:options.polarity??'positive',modality:options.modality??'asserted',conditional:options.conditional??conditional(seg.text),quoted:options.quoted??quoted(seg.text),evidence:ev(seg,match)});
}
function deniedBefore(text:string,index:number){
 const before=norm(text.slice(Math.max(0,index-45),index));
 return /\b(?:not|never|no|cannot|can't|unable to|doesn't|does not|isn't|is not|won't|will not|mustn't|must not|shouldn't|should not)\s*$/.test(before);
}
function questionLike(s:string){return /\?|\b(?:please (?:let (?:me|us) know|tell|confirm)|could you|would you|can you|do you|is there|whether|if you have|what is|when did|when was)\b/i.test(s);}

function extractFromSegments(segments:EvidenceLocationNextV1[],fullText:string):SemanticPropositionNextV1[]{
 const out:SemanticPropositionNextV1[]=[];
 const all=norm(fullText);
 const representative=(rx:RegExp)=>segments.find(s=>rx.test(norm(s.text)))??segments[0];
 const wholePush=(kind:PropositionKindNextV1,object:string,rx:RegExp,options:Partial<Omit<SemanticPropositionNextV1,'kind'|'object'|'evidence'>>={})=>{const s=representative(rx);if(s)push(out,s,kind,object,options);};
 // A compound policy proposition may span a heading plus list items.
 const policyAnchor=/\b(?:standard (?:return )?policy|standard returns?|standard return conditions?|standard eligibility)\b/.test(all)||/(^|[.!?]\s*)an unused item,?[^.!?]{0,90}\b30[ -]?days?\b[^.!?]{0,70}\breceipt\b/.test(all);
 if(policyAnchor
   &&/\bunused\b/.test(all)&&/\b(?:30|thirty)[ -]?days?\b/.test(all)&&/\bpurchase\b/.test(all)&&/\breceipt\b/.test(all)
   &&/\b(?:require\w*|condition\w*|must|need\w*|necessary|only if|provided|depends on|qualif\w*|covers|policy is|are all|can be returned)\b/.test(all)){
  const first=segments.find(s=>/standard/i.test(s.text))??segments[0];if(first)push(out,first,'standard_policy','unused AND within 30 days of purchase AND receipt',{subject:'standard return policy'});
 }
 const timingAnchor=/\b(?:purchase date|date of purchase|purchase age|purchase timing|date .* (?:item|it) (?:was )?purchased|when (?:it|the item) was purchased)\b/;
 if(timingAnchor.test(all)&&/\b(?:unknown|not known|not provided|not supplied|hasn't been supplied|has not been supplied|has not been provided|not available|unavailable|absent|missing|no purchase date (?:was|is) provided|not in (?:the )?supplied facts|not established|has not been established|cannot be established|can't be established|do not know|don't know|do not have|don't have|have not been given|remains unknown)\b/.test(all))wholePush('timing_unknown','purchase date or age is unknown',timingAnchor);
 const unknownOutcome=/\b(?:standard (?:eligibility|outcome|result)|eligibility)\b/;
 if(unknownOutcome.test(all)&&/\b(?:unknown|undetermined|unresolved|unsettled|undecided|not yet knowable|cannot yet be (?:determined|decided|settled)|can't yet be (?:determined|decided|settled)|cannot be (?:determined|decided|settled)|can't be (?:determined|decided|settled)|remains open|leaving .* open|no .* decision can yet be made|need(?:s)? more information to determine|not enough information to determine)\b/.test(all))wholePush('eligibility_unknown','standard eligibility is unknown',unknownOutcome,{subject:'case'});
 const intervalMention=/\b(?:mentioned|stated|reported|45[ -]?days?|60[ -]?days?|interval|damage .* noticed|noticing .*damage|discovered .*damage)\b/.test(all);
 const intervalSeparated=(/\b(?:not tied|not anchored) to (?:the )?purchase\b/.test(all)
   ||(/\b(?:does not|doesn't|cannot|can't|fails to)\b[^.!?]{0,45}\b(?:establish|show|tell|determine|prove)\b/.test(all)&&/\bpurchase (?:date|age)|when .*purchased|how old .*purchase\b/.test(all))
   ||/\b(?:purchase date|purchase age|purchase timing)\b[^.!?]{0,35}\b(?:is not|isn't|cannot be|can't be)\b[^.!?]{0,25}\bestablished by\b/.test(all)
   ||/\bno purchase (?:date|age) can be established from\b/.test(all));
 if(intervalMention&&intervalSeparated)wholePush('interval_not_purchase_age','mentioned interval does not establish purchase age',/(?:interval|45|60|damage)/);
 if(/\b(?:do not|don't|never|must not|should not|can't|cannot|neither)\b[^.!?]{0,120}\bpasswords?\b/.test(all)&&/\b(?:do not|don't|never|must not|should not|can't|cannot|neither)\b[^.!?]{0,160}\bfull\s+(?:credit |debit |payment |bank )?card\s+(?:numbers?|details)\b/.test(all))wholePush('privacy_warning','password and full card number must not be shared',/password/,{modality:'recommendation',subject:'customer'});
 const limitationSubject=/\b(?:i|we|this assistant|it)\b/;
 const limitationModality=/\b(?:cannot|can't|unable to|not able to|do not have (?:the )?(?:ability|capability) to)\b/;
 const hasRefundLimit=limitationModality.test(all)&&/\b(?:issue|process)\b[^.!?]{0,25}\brefunds?\b|\brefunds?\b[^.!?]{0,20}\bcannot be issued\b/.test(all);
 const hasDecisionLimit=limitationModality.test(all)&&/\b(?:change|alter|revise|overturn)\b[^.!?]{0,25}\bdecisions?\b|\bdecisions?\b[^.!?]{0,20}\bcannot be (?:changed|altered|revised)\b/.test(all);
 const hasForwardLimit=limitationModality.test(all)&&/\b(?:forward|relay|pass along)\b[^.!?]{0,25}\brequests?\b|\brequests?\b[^.!?]{0,20}\bcannot be (?:forwarded|relayed|passed along)\b/.test(all);
 const hasContactLimit=limitationModality.test(all)&&/\bcontact\b[^.!?]{0,25}\b(?:anyone|people|a person|another person)\b|\b(?:people|a person|another person)\b[^.!?]{0,20}\bcannot be contacted\b/.test(all);
 if(limitationSubject.test(all)||/\b(?:refunds?|decisions?|requests?|people)\b[^.!?]{0,25}\bcannot be\b/.test(all)){
  const objects=[hasRefundLimit?'refund':'',hasDecisionLimit?'decision':'',hasForwardLimit?'forward':'',hasContactLimit?'contact':''].filter(Boolean).join(',');
  if(objects)wholePush('capability_limitation',objects,/(?:cannot|can't|unable|refunds? cannot)/,{modality:'limitation',polarity:'negative',subject:'assistant'});
 }
 if(/\b(?:human review|review by (?:a )?(?:human|person)|reviewed by (?:a )?(?:human|person)|human reviewer|person must review|human must review|person .* review .* case)\b/.test(all)){
  const neg=/\b(?:does not|doesn't|need not|is not|isn't)\b[^.!?]{0,40}\b(?:require|need|required|needed|human review|reviewed by|person .* review)\b|\bno human review\b|\bno review (?:is )?(?:required|needed)\b/.test(all);
  wholePush('human_review','human review required',/(?:human review|review by|reviewed by|person must review|human must review)/,{subject:'case',polarity:neg?'negative':'positive'});
 }
 if(/\b(?:damag\w*|cracked|broken|defective)\b/.test(all)&&/\b(?:because|reason|why|due to|required because|review .* because|must review)\b/.test(all)&&/\b(?:human|person)\b[^.!?]{0,40}\breview|\breview\b[^.!?]{0,40}\b(?:human|person)\b/.test(all))wholePush('damage_review_reason','damage requires human review',/(?:damag|cracked|broken)/,{subject:'damage',polarity:/\b(?:no human review|does not require human review|no .*review .*needed)\b/.test(all)?'negative':'positive'});
 const dateNotNeeded=/\b(?:no|not)\s+(?:purchase date|date of purchase)\s+(?:is )?(?:needed|required|necessary)\b/.test(all);
 const asksDate=/\b(?:what (?:was|is) the purchase date|what date was (?:the item|it) purchased|when was (?:the item|it) purchased|when was the purchase|when did you (?:buy|purchase)|please (?:tell|state|say|provide|give|confirm)[^.!?]{0,35}(?:purchase date|date of purchase|date (?:you|it was) bought|when .*purchase)|could you (?:tell|provide|give|state)[^.!?]{0,35}(?:purchase date|date of purchase|date (?:you|it was) bought|when .*purchase)|let (?:me|us) know[^.!?]{0,35}(?:purchase date|date of purchase|date (?:you|it was) bought|when .*purchase)|confirm when the purchase occurred)\b/.test(all);
 if(asksDate&&!dateNotNeeded)wholePush('ask_purchase_date','customer is asked for purchase date',timingAnchor,{modality:'question'});
 if(dateNotNeeded)wholePush('ask_purchase_date','customer is told purchase date is not needed',/(?:purchase date|date of purchase)/,{modality:'asserted',polarity:'negative'});
 if(questionLike(fullText)&&/\b(?:whether|if|is)\b[^.!?]{0,75}\b(?:item|product|it)\b[^.!?]{0,35}\bunused\b/.test(all)&&!/\b(?:confirm that|assuming|since)\b[^.!?]{0,25}\b(?:item|it).*unused/.test(all))wholePush('ask_unused','customer is asked whether item is unused',/unused/,{modality:'question'});
 if(/\bconfirm (?:that )?(?:the )?(?:item|product|it) is (?:still )?unused\b/.test(all))wholePush('ask_unused','unused status is presupposed rather than asked',/confirm[^.!?]*unused/,{modality:'asserted',polarity:'negative'});
 if(questionLike(fullText)&&/\breceipt\b/.test(all)&&/\b(?:whether|if|do you have|is there|is a receipt|receipt exists|receipt is available|receipt availability)\b/.test(all)&&!/\b(?:upload|send|share|provide|attach)\b[^.!?]{0,30}\breceipt\b/.test(all))wholePush('ask_receipt_availability','customer is asked whether receipt exists',/receipt/,{modality:'question'});
 if(/\b(?:you|customer)\b[^.!?]{0,35}\b(?:can|may|should|could)\b[^.!?]{0,35}\b(?:contact|speak to|reach)\b[^.!?]{0,45}\b(?:human|support|representative)\b|\b(?:human support|human representative|support representative|human agent)\b[^.!?]{0,45}\b(?:may be|can be|is available to be)\b[^.!?]{0,20}\bcontacted by you\b|\b(?:human support|human representative)\b[^.!?]{0,40}\bavailable for you to contact\b|\bcontacting (?:a )?(?:human support|human representative)\b[^.!?]{0,50}\b(?:option|available)\b/.test(all))wholePush('contact_human','customer can contact human',/(?:contact|human support|human representative)/,{modality:'recommendation',subject:'customer'});
 if(/\b(?:contact|speak to|reach)\b[^.!?]{0,40}\b(?:human support|support agent|representative)\b[^.!?]{0,45}\b(?:only after|after you|not until|until you)\b|\b(?:only after|not until|until)\b[^.!?]{0,60}\b(?:purchase date|date|information)\b[^.!?]{0,60}\b(?:contact|speak to|reach)\b/.test(all))wholePush('clarification_prerequisite','clarification required before human contact',/(?:only after|not until|until)/,{subject:'customer'});
 if(/\b(?:OUTSIDE_STANDARD_WINDOW|RECEIPT_MISSING|ITEM_USED|STANDARD_INELIGIBLE|STANDARD_ELIGIBILITY_UNKNOWN|ACTION_REQUESTED|DAMAGED_ITEM|POLICY_DISPUTE)\b/i.test(fullText))wholePush('internal_enum','internal enum exposed',/(?:internal result|outside_standard|standard_eligibility)/i);
 for(const seg of segments){const t=norm(seg.text);if(!t)continue;
  const add=(kind:PropositionKindNextV1,obj:string,opts:Partial<Omit<SemanticPropositionNextV1,'kind'|'object'|'evidence'>>={},rx?:RegExp)=>{const m=rx?t.match(rx):null;push(out,seg,kind,obj,opts,m);};
  if(/\b(?:purchase date|date of purchase|purchase age|when (?:the item|it|you) (?:was |were )?(?:bought|purchased)|when (?:was|were) (?:the item|it) (?:bought|purchased))\b/.test(t)){
   if(/\b(?:unknown|not known|not provided|not available|do not know|don't know|have not been given|has not been given|cannot determine|can't determine|missing)\b/.test(t))add('timing_unknown','purchase date or age is unknown');
   if(questionLike(seg.text)&&!/(?:no need|do not need|don't need|unnecessary)\b[^.!?]{0,30}\b(?:purchase date|date of purchase)/.test(t))add('ask_purchase_date','customer is asked for purchase date',{modality:'question'});
  }
  const caseAnchor=/\b(?:your|this|the)\s+(?:purchase|return|item|case)\b|\byou (?:bought|purchased)\b/.test(t);
  if(caseAnchor&&/\b(?:within|inside)\b[^.!?]{0,35}\b(?:30[ -]?day|standard return|standard window)\b|\b(?:10|12) days? (?:ago|since purchase)\b/.test(t)&&!/\b(?:not|isn't|is not|outside|beyond|past)\b[^.!?]{0,20}\b(?:within|inside)\b/.test(t)&&!/\b(?:cannot|can't|unable to)\b[^.!?]{0,35}\b(?:determine|confirm|know)\b[^.!?]{0,35}\b(?:if|whether)\b/.test(t))add('timing_within','case purchase is within standard window',{subject:'case'});
  if(caseAnchor&&/\b(?:outside|beyond|past)\b[^.!?]{0,45}\b(?:30[ -]?day|standard return|standard window|window)\b|\b31 days? (?:ago|after purchase|since purchase)\b|\bmore than 30 days? ago\b/.test(t)&&!/\b(?:not|isn't|is not|no more than)\b[^.!?]{0,20}\b(?:outside|beyond|past|more than)\b/.test(t)&&!/\bno more than 30 days? ago\b/.test(t))add('timing_outside','case purchase is outside standard window',{subject:'case'});
  if(/\b(?:mentioned|stated|45[ -]?day|60[ -]?day|interval|damage timing|arrival timing|discovery timing)\b/.test(t)&&/\b(?:does not|doesn't|cannot|can't|is not enough to|fails to)\b[^.!?]{0,60}\b(?:establish|show|tell|determine|prove)\b[^.!?]{0,55}\b(?:purchase date|purchase age|when .*purchased|how old .*purchase)\b/.test(t))add('interval_not_purchase_age','mentioned interval does not establish purchase age');
  const elig=/\b(?:standard (?:return )?(?:eligibility|conditions?)|eligible under the standard|qualif(?:y|ies) under the standard|standard return)\b/.test(t);
  if(elig&&/\b(?:eligible|qualif(?:y|ies)|conditions? (?:are|is) met|meets? .*conditions?|facts? (?:satisfy|meet)|satisf(?:y|ies) .*conditions?)\b/.test(t)&&!/\b(?:not|ineligible|cannot|can't|unknown|undetermined)\b[^.!?]{0,25}\b(?:eligible|qualif|conditions? met)/.test(t))add('eligibility_eligible','standard eligibility is eligible',{subject:'case'});
  if(/\b(?:ineligible|not eligible|does not qualify|doesn't qualify|standard condition (?:is|was) not met|standard conditions? (?:are|is) not met)\b/.test(t))add('eligibility_ineligible','standard eligibility is ineligible',{subject:'case'});
  if(/\b(?:cannot|can't|unable to|not enough information to|need(?:s)? more information to)\b[^.!?]{0,60}\b(?:determine|confirm|assess|decide)\b[^.!?]{0,55}\b(?:eligibility|eligible|standard conditions?)\b|\b(?:standard )?eligibility\b[^.!?]{0,35}\b(?:unknown|undetermined|not yet known|cannot .* determined|can't .* determined)\b/.test(t))add('eligibility_unknown','standard eligibility is unknown',{subject:'case'});
  if(/\b(?:receipt (?:condition|requirement|availability)|without (?:a |the )?receipt|no receipt|receipt is missing|receipt is not available|lost .*receipt)\b/.test(t)&&/\b(?:not met|unmet|ineligible|not eligible|required|cannot|can't|missing|without|lost|false|fails?)\b/.test(t))add('receipt_unmet','receipt condition is not met',{subject:'case'});
  if(/\b(?:item|product|it)\b[^.!?]{0,25}\b(?:used|not unused)\b/.test(t)&&/\b(?:condition|requirement|ineligible|not eligible|not met|unmet)\b/.test(t))add('item_unmet','unused condition is not met',{subject:'case'});
  const reviewMention=/\b(?:human review|reviewed by (?:a )?(?:human|person)|human reviewer|review by (?:a )?(?:human|person)|(?:human|person) must review)\b/.exec(t);
  if(reviewMention){const negative=/\b(?:does not|doesn't|need not|is not|isn't|no)\b[^.!?]{0,24}\b(?:require|need|required|needed)?\s*(?:a )?human review\b|\bdoes not need to be reviewed by/.test(t);add('human_review','human review required',{subject:'case',polarity:negative?'negative':'positive'},/\b(?:human review|reviewed by (?:a )?human|human reviewer)\b/);
   if(/\b(?:damag\w*|cracked|broken|defective)\b/.test(t)&&/\b(?:because|reason|requires?|needs?|why|due to)\b/.test(t))add('damage_review_reason','damage requires human review',{subject:'damage',polarity:negative?'negative':'positive'});
  }
  const hasSecret=/\bpasswords?\b/.test(t),hasCard=/\bfull\s+(?:credit |debit |payment |bank )?card\s+(?:numbers?|details)\b/.test(t);
  if((hasSecret||hasCard)&&/\b(?:do not|don't|never|must not|mustn't|should not|shouldn't|cannot|can't)\b[^.!?]{0,65}\b(?:send|share|provide|enter|disclose)\b|\b(?:do not|don't|never|must not|should not)\s+(?:send|share|provide|enter|disclose)\b/.test(t))add('privacy_warning',(hasSecret?'password':'')+(hasSecret&&hasCard?' and ':'')+(hasCard?'full card number':'')+' must not be shared',{modality:'recommendation',subject:'customer'});
  const capability=/\b(?:i|we|this assistant)\b[^.!?]{0,20}\b(?:cannot|can't|am unable to|are unable to|do not have (?:the )?(?:ability|capability) to)\b/.test(t);
  if(capability){const objects=['refund','decision','forward','contact'].filter(x=>t.includes(x));add('capability_limitation',objects.join(','),{modality:'limitation',polarity:'negative',subject:'assistant'});}
  const listQuestion=questionLike(seg.text)||/^\s*[-*\d)]+\s*/.test(seg.text)&&/\b(?:whether|if)\b/.test(t);
  if(listQuestion&&/\b(?:whether|if|is)\b[^.!?]{0,35}\b(?:item|product|it)\b[^.!?]{0,25}\bunused\b|\bis the (?:item|product) unused\b/.test(t)&&!/\b(?:confirm that|assuming|since)\b[^.!?]{0,20}\b.*unused/.test(t))add('ask_unused','customer is asked whether item is unused',{modality:'question'});
  if(listQuestion&&/\b(?:whether|if|do you|is there|is a|is the)\b[^.!?]{0,30}\b(?:have|receipt|available|exists?)\b|\b(?:receipt availability|a receipt is available)\b/.test(t)&&!/\b(?:upload|send|share|provide|attach|copy|photo|scan|number|contents?|details?|proof)\b/.test(t))add('ask_receipt_availability','customer is asked whether receipt exists',{modality:'question'});
  if(/\b(?:you|customer)\b[^.!?]{0,20}\b(?:can|may|should|could)\b[^.!?]{0,15}\b(?:contact|speak to|reach|ask)\b[^.!?]{0,40}\b(?:human|support agent|representative)\b|\b(?:contact|speak to|reach)\b[^.!?]{0,35}\b(?:a |the )?(?:human support|human agent|support agent|representative)\b/.test(t))add('contact_human','customer can contact human',{modality:'recommendation',subject:'customer'});
  if(/\b(?:must|need to|have to|required to)\b[^.!?]{0,55}\b(?:provide|give|confirm|tell)\b[^.!?]{0,40}\b(?:purchase date|date of purchase|information|details)\b[^.!?]{0,35}\bbefore\b[^.!?]{0,35}\b(?:contact|speak|reach)\b|\b(?:cannot|can't|may not)\b[^.!?]{0,35}\b(?:contact|speak|reach)\b[^.!?]{0,35}\buntil\b/.test(t))add('clarification_prerequisite','clarification required before human contact',{subject:'customer'});
  const action=/\b(?:sent|forwarded|transferred|escalated|submitted|processed|issued|approved|opened|contacted|will (?:contact|follow up|reach out|open|issue|process|forward|escalate)|(?:i|we)(?:'ll| will) (?:contact|follow up|reach out|open|issue|process|forward|escalate)|(?:agent|team|representative|they)(?:'ll| will) (?:contact|follow up|reach out|open|issue|process|forward|escalate)|you will receive)\b/.exec(t);
  const customerPassive=/\b(?:may|can) be contacted by you\b|\bavailable for you to contact\b/.test(t),limitation=/\b(?:cannot|can't|unable to|not able to)\b/.test(t),denial=/\b(?:no refund|not approved|not processed|not executed|does not approve|doesn't approve)\b/.test(t);
  if(action&&!customerPassive&&!limitation&&!denial&&!deniedBefore(t,action.index??0)&&!conditional(t))push(out,seg,'external_action','external action asserted or promised',{modality:/\b(?:will|'ll)\b/.test(t)?'promise':'asserted',subject:/\b(?:agent|team|representative|they)\b/.test(t)?'third-party':'assistant'},action);
  if(/\b(?:refund|return)\b[^.!?]{0,35}\b(?:is|was|has been|will be)\b[^.!?]{0,25}\b(?:approved|processed|guaranteed|issued|refunded)\b|\b(?:you|customer)\b[^.!?]{0,20}\bwill\b[^.!?]{0,12}\b(?:receive|get)\b[^.!?]{0,12}\b(?:a |the )?refund\b|\b(?:i|we|assistant)\b[^.!?]{0,15}\b(?:will|'ll|shall)\b[^.!?]{0,12}\b(?:issue|process)\b[^.!?]{0,15}\b(?:your |a |the )?refund\b|\b(?:refund|return)\b[^.!?]{0,20}\bcan be refunded\b/.test(t)&&!/\b(?:no refund|not approved|not processed|not guaranteed|isn't approved|is not approved|cannot approve|can't approve|does not approve|doesn't approve)\b/.test(t))add('refund_approval','refund/return approval or execution asserted',{subject:'case'});
  if(/\b(?:send|share|provide|enter|upload|disclose)\b[^.!?]{0,35}\b(?:passwords?|full (?:credit |debit |payment |bank )?card (?:numbers?|details))\b/.test(t)&&!/\b(?:do not|don't|never|must not|should not|cannot|can't)\b[^.!?]{0,25}\b(?:send|share|provide|enter|upload|disclose)\b/.test(t))add('secret_request','secret requested',{modality:'question',subject:'customer'});
  if(/\b(?:we|i|the system|this service|the company)\b[^.!?]{0,40}\b(?:store|share|retain|delete|erase|encrypt|sell|disclose|keep)\b[^.!?]{0,55}\b(?:data|information|details)|\b(?:data|information|details)\b[^.!?]{0,45}\b(?:is|are|will be|is not|are not|won't be)\b[^.!?]{0,30}\b(?:stored|shared|retained|deleted|erased|encrypted|sold|disclosed|kept)\b/.test(t))add('data_handling','unsupported data-handling policy asserted',{subject:'organization'});
  if(/\b(?:we|the company|this service)\b[^.!?]{0,25}\b(?:do not|don't|never|only)\b[^.!?]{0,20}\brequest\b[^.!?]{0,35}\b(?:personal data|personal information|sensitive data|sensitive personal data|payment information)\b/.test(t))add('data_handling','unsupported organizational data-request practice asserted',{subject:'organization'});
  if((/\b(?:send|share|provide|upload|attach|submit|enter|give)\b[^.!?]{0,28}\b(?:the |your |a )?(?:receipt|receipt (?:contents?|number|details?)|photo|copy|scan|image|proof of purchase)\b|\b(?:receipt (?:contents?|number|details?)|photo|copy|scan|image|proof of purchase)\b[^.!?]{0,28}\b(?:send|share|provide|upload|attach|submit)\b/.test(t))&&!/\b(?:do not|don't|no need to|not necessary to)\b[^.!?]{0,25}\b(?:send|share|provide|upload|attach|submit)\b/.test(t))add('receipt_material_request','receipt material requested',{modality:'question',subject:'customer'});
  if(/\b(?:OUTSIDE_STANDARD_WINDOW|RECEIPT_MISSING|ITEM_USED|STANDARD_INELIGIBLE|STANDARD_ELIGIBILITY_UNKNOWN|ACTION_REQUESTED|DAMAGED_ITEM|POLICY_DISPUTE)\b/i.test(seg.text))add('internal_enum','internal enum exposed');
  if(/\b(?:website|portal|phone|email|store|store desk|store location|app|ticket|case number|processing time|business days?)\b/.test(t))add('unsupported_channel_or_process','unsupported channel or process asserted');
 }
 return out;
}

export function parseSemanticEvidenceNextV1(raw:string|undefined,mode:'plain'|'json'):ParsedResponseNextV1{
 const original=raw??'',formatFailures:string[]=[];let jsonEligible:boolean|null=null;let segments:EvidenceLocationNextV1[]=[];
 if(!original.trim())formatFailures.push('COMPLETE_RESPONSE');
 if(mode==='plain'){
  if(/^\s*[\[{]/.test(original))formatFailures.push('FORMAT_PLAIN');
  segments=splitField(original,'plain','$');
 }else{
  try{
   const duplicates=duplicateTopLevelKeys(original);if(duplicates.length)formatFailures.push('JSON_DUPLICATE_KEY');
   const parsed=JSON.parse(original);
   const exact=parsed!==null&&!Array.isArray(parsed)&&Object.keys(parsed).sort().join(',')==='eligible,nextStep,reason'&&typeof parsed.eligible==='boolean'&&typeof parsed.reason==='string'&&parsed.reason.trim()&&typeof parsed.nextStep==='string'&&parsed.nextStep.trim();
   if(!exact)formatFailures.push('FORMAT_JSON_EXACT');
   else{jsonEligible=parsed.eligible;segments=[...splitField(parsed.reason,'json','$.reason'),...splitField(parsed.nextStep,'json','$.nextStep')];}
  }catch{formatFailures.push('FORMAT_JSON_EXACT');}
 }
 const visible=segments.map(x=>x.text).join(' ');
 return {original,mode,formatOk:formatFailures.length===0,formatFailures,jsonEligible,segments,propositions:extractFromSegments(segments,visible)};
}
