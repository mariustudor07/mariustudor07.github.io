---
layout: post
title: "Three AI Security Certs, and Why I Bothered"
date: 2026-07-13
category: "AI Security"
tags: [ai-security, red-team, llm, prompt-injection, cranium]
excerpt: "I sat the Cranium AI Security, AI Red Team, and AI Security Professional certs back to back. Not for the badges, but because I'm building a tool that attacks the exact thing they defend."
---

> I picked up three Cranium AI certifications this month: AI Security, AI Red
> Team, and AI Security Professional. The honest reason isn't the LinkedIn line.
> It's that I've spent a year building an AI-powered pentest framework, and at
> some point you have to stop guessing at how these systems break and go learn
> the actual threat model.

For context, my main project is an [AI red team framework](https://github.com/mariustudor07/ai-pentest-agent) with
a local LLM doing recon, correlation, and reporting. The whole time I've been
building it, a quiet question kept nagging me. I know how to *use* an LLM to
attack things, but do I actually understand how the LLM itself gets attacked?
Those are two very different skill sets, and I was strong on the first and
hand-wavy on the second. These three certs were me closing that gap on purpose.

## The three, and how they stack

They're meant to be taken in order, and it shows.

- **AI Security** is the foundations. What the attack surface of a model-backed
  system actually *is*, which is bigger than most people think. It's not just
  the model. It's the training data, the pipeline, the prompt boundary, the
  plugins and tools you bolt on, and the humans in the loop.
- **AI Red Team** is the offensive half, and the one I cared about most.
  Adversarial thinking applied to models: making them do things they shouldn't,
  leak things they shouldn't, and trust input they shouldn't.
- **AI Security Professional** pulls the two together into how you actually run
  this as a practice. Governance, risk, and defending the pipeline end to end
  rather than plugging one hole at a time.

## What actually landed

A few things reframed how I think, rather than just adding facts.

**The prompt boundary is the new trust boundary.** In web security you learn early
that user input is hostile until proven otherwise. With LLMs the boundary is
fuzzier and worse, because instructions and data arrive through the *same
channel*. A model can't cleanly tell "this is a command from my operator" from
"this is text I was asked to summarise." That's the whole reason prompt injection
works, and it's why my framework now treats anything it scrapes off a target as
untrusted by default. It didn't before. That's a direct change I made off the
back of this.

**The attack surface is a supply chain, not a box.** Data poisoning, model theft,
membership inference, a compromised dependency in the serving stack. The model
weights are only one node. The Security Professional material hammered this, and
it maps almost one to one onto how I already think about a network. You don't
just harden the crown jewel, you assume the path *to* it is contested.

**Red teaming a model rhymes with red teaming a box, but the primitives differ.**
It's the same loop I know from HTB, which is enumerate, find the boundary, push
on it, escalate. The primitives are just jailbreaks, injection, and extraction
instead of ports and services. That parallel made the offensive material click
fast, because I wasn't learning a mindset, only a new vocabulary for one I
already had.

## Was it worth it?

For me, yes, and I can be specific about why. I didn't take these to prove I know
AI security. I took them because I'm shipping something that lives in this space,
and I was making design decisions on instinct where I should have been making
them on a threat model. The clearest signal that it worked is that I changed how
my framework handles untrusted input the same week. That's the bar I hold any
cert to. Did it change what I build, or just what my profile says?

If you're doing offensive security and haven't looked seriously at how AI systems
get attacked, it's coming for your scope whether you're ready or not. Every
product is quietly growing an LLM feature, and every one of those is new, poorly
understood attack surface. Worth getting ahead of.

## The certificates

If you want to check the receipts:

- [AI Security Professional](/assets/certs/cranium-ai-security-professional.pdf), Credential ID `58748923-ebef-4e68-87af-5de83e672c71`
- [AI Red Team](/assets/certs/cranium-ai-red-team.pdf), Credential ID `a338f6d7-c9b8-49f0-9703-f98b97aa59df`
- [AI Security](/assets/certs/cranium-ai-security.pdf), Credential ID `7b0faee2-84ea-4290-9405-ccdba1106a76`

All three issued by Cranium AI, July 2026.

Next up is folding what I learned into the framework properly: an injection-aware
input layer, and a small harness for testing my own tooling the way I'd test a
target. That's the real deliverable. The certs were just the reading list.
